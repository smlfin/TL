// ====================================================================
// 1. CONSTANTS AND HELPER FUNCTIONS
// ====================================================================

// API URL now points to the Netlify Function proxy (or your actual endpoint)
const API_URL = "/.netlify/functions/fetch-data"; 
const CLIENT_SIDE_AUTH_KEY = "123"; // The simple password for write/edit operations

let ALL_RECORDS = []; 
window.CURRENT_LOAN_RECORD = null;

// Advocate Tracker Status Definitions
const STATUS_FIELD = "Advocate Payment Status";
const STATUS_OPTIONS = ["Processing", "Rejected", "Paid"]; 

// Fields that contain dates and need conversion
const DATE_FIELDS = [
    "Loandate", 
    "Due Date", 
    "Last Receipt Date", 
    "Demand Notice Sent Date", 
    "CQ DATE/PRESENTATION DATE", 
    "CQ RETURN DATE", 
    "HANDED OVER DATE", 
    "Sec9FilingDate",
    "AttachmentEffDate"
];

// CRITICAL FIELDS for Highlighting
const CRITICAL_FIELDS = [
    "Arrear Amount", 
    "Loan Balance",
    "CASE NO", 
    "CASENOSec9" 
];

// Helper function to format date strings from Google Sheets to dd/mm/yyyy
function formatDate(dateValue) {
    if (!dateValue || dateValue === 'N/A' || String(dateValue).startsWith('18')) {
        return dateValue;
    }
    
    let date;
    // 1. Try to parse as a standard JavaScript date
    date = new Date(dateValue);
    
    // 2. If standard parsing fails (i.e., it's a raw string)
    if (isNaN(date.getTime())) {
        try {
            const parts = String(dateValue).trim().split(/[\.\/]/); 
            
            if (parts.length === 3) {
                const day = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10);
                const year = parseInt(parts[2], 10);
                
                if (day > 0 && month > 0 && year > 1900) {
                    date = new Date(Date.UTC(year, month - 1, day)); 
                    if (isNaN(date.getTime())) {
                        return dateValue; 
                    }
                } else {
                    return dateValue; 
                }
            } else {
                return dateValue; 
            }
        } catch (e) {
            return dateValue; 
        }
    }

    // 3. Final formatting if a valid date object was created
    if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-GB', { timeZone: 'UTC' });
    }

    return dateValue; // Fallback
}


// Helper function to safely parse a value
const parseNumber = (value) => {
    if (typeof value === 'string') {
        value = value.replace(/[$,]/g, '').trim();
    }
    const number = parseFloat(value);
    return isNaN(number) ? 0 : number;
};

// ====================================================================
// NEW HELPER: Get the correct payment status for the tracker view
// ====================================================================
/**
 * Determines the correct payment status column based on which advocate matches the tracker's selected advocate.
 * @param {object} record - The loan record object.
 * @param {string} currentAdvocate - The name of the advocate selected in the tracker dropdown.
 * @returns {string} The status value or 'Processing' if unset.
 */
function getAdvocatePaymentStatusForTracker(record, currentAdvocate) {
    if (!record || !currentAdvocate) return 'N/A';
    
    const normalizedAdvocate = String(currentAdvocate).trim();
    
    // If the advocate is the primary 'ADVOCATE' -> Read status from the '138 Payment' column
    if (String(record['ADVOCATE']).trim() === normalizedAdvocate) {
        return record['138 Payment'] || 'Processing';
    } 
    
    // If the advocate is the secondary 'Sec/9 Advocate' -> Read status from the 'sec9 Payment' column
    if (String(record['Sec/9 Advocate']).trim() === normalizedAdvocate) {
        return record['sec9 Payment'] || 'Processing';
    }
    
    return 'N/A'; // Advocate not associated with this record
}


// Helper function to format currency for display
function formatCurrency(value) {
    const number = parseNumber(value);
    if (isNaN(number)) return 'N/A';
    return number.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
}

// Function to calculate net total for any group of charges 
function calculateChargesNet(record, fields) {
    let total = 0;
    
    fields.forEach(field => {
        let sign = 1; 
        if (field.includes("TDS")) {
            sign = -1; // TDS is subtracted
        }
        total += parseNumber(record[field]) * sign;
    });

    return total;
}

/**
 * Function to calculate the required Advocate Fee Payment Net (Fees - TDS, ignoring GST)
 * @param {object} record - The loan record object.
 * @param {string[]} feeFields - The list of fields containing fees (excluding GST fields).
 * @returns {number} The net payment amount.
 */
function calculateAdvocateFeePaymentNet(record, feeFields) {
    let totalNet = 0;
    
    feeFields.forEach(field => {
        const value = parseNumber(record[field]);

        if (field.includes("TDS")) {
            totalNet -= value; // Subtract TDS
        } else if (!field.includes("GST")) {
            totalNet += value; // Add Fee (but ignore GST)
        }
    });

    return totalNet;
}

// Helper to calculate the total Net Fee for a group of records for the selected advocate
function calculateAdvocateTotalNetFee(records, advocateName) {
    let totalNetFee = 0;
    const normalizedAdvocate = String(advocateName).trim();
    
    records.forEach(record => {
        const is138Advocate = String(record['ADVOCATE']).trim() === normalizedAdvocate;
        const isSec9Advocate = String(record['Sec/9 Advocate']).trim() === normalizedAdvocate;

        // An advocate might be associated with both, so we sum both section fees if applicable
        if (is138Advocate) {
            // Calculate 138 fees net
            totalNetFee += calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields);
        }
        if (isSec9Advocate) {
            // Calculate Sec 9 fees net
            totalNetFee += calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
        }
    });

    return totalNetFee;
}


// --- CHARGE FIELD DEFINITIONS FOR BLOCKS 5 & 6 ---
const CHARGE_DEFINITIONS_138 = {
    // Fields that contribute to the NET calculation (Fees - TDS, ignoring GST)
    "AdvocateFeeNetFields": [
        "Initial Fee for Sec.138", 
        "TDS of Sec.138 Initial Fee", 
        "Final fee for Sec 138", 
        "TDS of Final fee for Sec 138", 
    ],
    // The list of all Advocate Fee fields to display in Block 5/Tracker breakdown
    "AdvocateFeeFieldsDisplay": [
        "Initial Fee for Sec.138",
        "GST of Sec.138 Initial Fee",
        "TDS of Sec.138 Initial Fee",
        "Final fee for Sec 138",
        "GST of Final fee for Sec 138",
        "TDS of Final fee for Sec 138",
    ],
    // Other Charges Net Group
    "OtherChargesFields": [
        "Cheque Return Charges",
        "POA for Filing Sec 138",
        "Sec.138 Notice Expense",
        "Warrant Steps of Sec 138",
    ]
};

// 6) Section 09 Fee & Charges Definitions
const CHARGE_DEFINITIONS_09 = {
    // Fields that contribute to the NET calculation (Fees - TDS, ignoring GST)
    "AdvocateFeeNetFields": [
        "Initial Fee for Sec 09", 
        "TDS of Initial Fee", 
        "Final Fee For Sec 09", 
        "TDS of Final Fee For Sec 09", 
    ],
    // The list of all Advocate Fee fields to display in Block 6/Tracker breakdown
    "AdvocateFeeFieldsDisplay": [
        "Initial Fee for Sec 09",
        "GST of Sec 09 Initial Fee",
        "TDS of Initial Fee",
        "Final Fee For Sec 09",
        "GST of Final Fee For Sec 09",
        "TDS of Final Fee For Sec 09",
    ],
    // Other Charges Net Group
    "OtherChargesFields": [
        "Taken Expense for Sec 09 filing",
        "POA for Filing Sec 09",
        "Fresh Notice Expense for Filing Sec 09",
        "Attachment Batta For Sec 09",
        "Attachment Petition",
        "Property Attachment Expense",
        "Sec 09 Court fee & E-Filing Expense",
        "Attachment Lifting Expense",
    ]
};

// All Charge Fields for Snapshot Box Total
const CHARGE_FIELDS_FOR_SNAPSHOT = [
    "Demand Notice Expense",
    ...CHARGE_DEFINITIONS_138.AdvocateFeeFieldsDisplay.filter(f => !f.includes("GST")), // Fees and TDS (Net)
    ...CHARGE_DEFINITIONS_138.OtherChargesFields,
    ...CHARGE_DEFINITIONS_09.AdvocateFeeFieldsDisplay.filter(f => !f.includes("GST")), // Fees and TDS (Net)
    ...CHARGE_DEFINITIONS_09.OtherChargesFields,
];

// Helper function to calculate the total for the Snapshot Box
function calculateTotalCharges(record) {
    return calculateChargesNet(record, CHARGE_FIELDS_FOR_SNAPSHOT.map(f => f));
}


// --- DISPLAY CONFIGURATION (All Fields) ---
const DISPLAY_BLOCKS = [
    {
        title: "1) Customer & Loan Details",
        fields: {
            "Loan Branch": "Branch",
            "Loan No": "Loan No",
            "Customer Name": "Customer Name",
            "Mobile": "Mobile",
            "Loandate": "Loan Date",
            "Loan Amount": "Loan Amount",
            "EMI": "EMI",
            "Due Date": "Due Date",
            "Tenure": "Tenure",
            "Paid": "Paid",
            "Arrear": "Arrear",
            "Arrear Amount": "Arrear Amount",
            "Loan Balance": "Loan Balance",
            "Arrear From To": "Arrear From To",
            "Status": "Status",
            "Last Receipt Date": "Last Receipt Date",
        }
    },
    {
        title: "2) Legal Action Recommendation & Remarks",
        fields: {
            "Demand Notice Sent Date": "Demand Notice Sent Date",
            "V P Remarks": "V P Remarks",
            "Legal Remarks": "Legal Remarks",
        }
    },
    {
        title: "3) Cheque return status",
        fields: {
            "CHEQ. NO.": "Cheque Number",
            "CQ DATE/PRESENTATION DATE": "Cheque presentation Date",
            "CQ RETURN DATE": "Cheque return Date",
            "AMOUNT": "AMOUNT",
            "B/G": "Borrower / Guarantor",
            "BANK": "BANK",
            "REMARKS": "REMARKS",
            "ADVOCATE": "ADVOCATE", 
            "HANDED OVER DATE": "HANDED OVER DATE",
            "Notice Remarks": "Notice Remarks",
            "CASE FILED": "CASE FILED",
            "CASE NO": "CASE NO", 
        }
    },
    {
        title: "4) Section 9 Status",
        fields: {
            "Sec/9 Filing Date": "Sec-09 Filing Date",
            "Sec/9 Filing Amt": "Sec-09 Filing Amount",
            "Sec/9 Advocate": "Advocate", 
            "Sec/9 Case No": "CASE NO",  
            "Attachment eff Date": "Attachment eff Date",
        }
    },
    {
        title: "5) Section 138 Fee & Charges",
        fields: {
            "Initial Fee for Sec.138": "Initial Fee",
            "GST of Sec.138 Initial Fee": "GST of Initial Fee",
            "TDS of Sec.138 Initial Fee": "TDS of Initial Fee",
            "Final fee for Sec 138": "Final fee",
            "GST of Final fee for Sec 138": "GST of Final fee",
            "TDS of Final fee for Sec 138": "TDS of Final fee",
            "Cheque Return Charges": "Cheque Return Charges",
            "POA for Filing Sec 138": "POA for Filing",
            "Sec.138 Notice Expense": "Notice Expense",
            "Warrant Steps of Sec 138": "Warrant Steps",
        }
    },
    {
        title: "6) Section 09 Fee & Charges",
        fields: {
            "Initial Fee for Sec 09": "Initial Fee",
            "GST of Sec 09 Initial Fee": "GST of Initial Fee",
            "TDS of Initial Fee": "TDS of Initial Fee",
            "Final Fee For Sec 09": "Final Fee",
            "GST of Final Fee For Sec 09": "GST of Final Fee",
            "TDS of Final Fee For Sec 09": "TDS of Final Fee",
            "Taken Expense for Sec 09 filing": "Schedule Taken Expense",
            "POA for Filing Sec 09": "POA for Filing",
            "Fresh Notice Expense for Filing Sec 09": "Fresh Notice Expense",
            "Attachment Batta For Sec 09": "Attachment Batta",
            "Attachment Petition": "Attachment Petition",
            "Property Attachment Expense": "Property Attachment Expense",
            "Sec 09 Court fee & E-Filing Expense": "Court fee & E-Filing Expense",
            "Attachment Lifting Expense": "Attachment Lifting Expense",
        }
    }
];

// ====================================================================
// 2. DOM ELEMENTS & INITIALIZATION
// ====================================================================

const FORM = document.getElementById('record-form');
const MESSAGE_ELEMENT = document.getElementById('submission-message');
const AUTH_KEY_INPUT = document.getElementById('auth-key');
const AUTH_BUTTON = document.getElementById('enable-input-button'); 
const AUTH_LABEL = document.querySelector('label[for="auth-key"]');
const BRANCH_SELECT = document.getElementById('branch-select');
const LOAN_SELECT = document.getElementById('loan-select');
const SEARCH_BUTTON = document.getElementById('search-button');
const LOADING_STATUS = document.getElementById('loading-status');
const DATA_BLOCKS_CONTAINER = document.getElementById('data-blocks');
const DATA_VIEW_SECTION = document.getElementById('data-view-blocks');
const NOT_FOUND_MESSAGE = document.getElementById('not-found-message');
// const SNAPSHOT_BOX = document.getElementById('loan-snapshot-box'); // Original snapshot box
const HEADER_INPUT = document.getElementById('header_name'); 
const DATA_INPUT = document.getElementById('data_value');
const ADVOCATE_FEE_CONTROLS = document.getElementById('advocate-fee-controls');
const ADVOCATE_FEE_TOGGLE = document.getElementById('advocate-fee-toggle');

// Elements for Advocate Tracker
const ADVOCATE_TRACKER_SELECT = document.getElementById('advocate-tracker-select');
const ADVOCATE_PAYMENTS_VIEW = document.getElementById('advocate-payments-view');
const ADVOCATE_TRACKER_INITIAL_MESSAGE = document.getElementById('advocate-tracker-initial-message');
const ADVOCATE_PAYMENT_SNAPSHOT_BOX = document.getElementById('advocate-payment-snapshot-box'); 
const ADVOCATE_PAYMENTS_TABLE_CONTAINER = document.getElementById('advocate-payments-table-container');


// ====================================================================
// 3. DROPDOWN POPULATION & CORE LOGIC
// ====================================================================

function populateBranchDropdown(branches) {
    BRANCH_SELECT.innerHTML = '<option value="">-- Select Branch --</option>';
    branches.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch;
        option.textContent = branch;
        BRANCH_SELECT.appendChild(option);
    });
}

function populateLoanDropdown(loans) {
    LOAN_SELECT.innerHTML = '<option value="">-- Select Loan --</option>';
    loans.forEach(loan => {
        const option = document.createElement('option');
        option.value = loan;
        option.textContent = loan;
        LOAN_SELECT.appendChild(option);
    });
    LOAN_SELECT.disabled = loans.length === 0;
    SEARCH_BUTTON.disabled = true;
}

function populateAdvocateDropdown(advocates) {
    ADVOCATE_TRACKER_SELECT.innerHTML = '<option value="">-- Select Advocate --</option>';
    advocates.forEach(advocate => {
        const option = document.createElement('option');
        option.value = advocate;
        option.textContent = advocate;
        ADVOCATE_TRACKER_SELECT.appendChild(option);
    });
}

/**
 * CORE FUNCTION: Fetches all data and initializes the application.
 */
async function initialLoad() {
    LOADING_STATUS.textContent = 'Loading all data from server...';
    LOADING_STATUS.style.display = 'block';
    
    try {
        // Assume API_URL is configured to handle the main data fetch
        const response = await fetch(API_URL);
        const result = await response.json();
        
        if (result.status === 'success') {
            ALL_RECORDS = result.data;
            // Get unique branches
            const branches = [...new Set(ALL_RECORDS.map(record => record['Loan Branch']).filter(b => b))].sort();
            
            // Populate branch dropdown
            populateBranchDropdown(branches);
            
            // Populate advocate dropdown for the tracker
            const advocates = [...new Set(
                ALL_RECORDS.flatMap(record => [record['ADVOCATE'], record['Sec/9 Advocate']])
                           .filter(a => a)
                           .map(a => String(a).trim())
            )].sort();
            populateAdvocateDropdown(advocates);

            LOADING_STATUS.textContent = `Data loaded successfully. Total records: ${ALL_RECORDS.length}`;
            LOADING_STATUS.style.color = 'var(--color-success)';
        } else {
            LOADING_STATUS.textContent = `❌ Error fetching data: ${result.message}`;
            LOADING_STATUS.style.color = 'var(--color-danger)';
        }
    } catch (error) {
        console.error("Fetch Error:", error);
        LOADING_STATUS.textContent = `❌ Network Error: Could not connect to API.`;
        LOADING_STATUS.style.color = 'var(--color-danger)';
    } finally {
        // Hide loading status after a brief delay
        setTimeout(() => {
            LOADING_STATUS.style.display = 'none';
        }, 2000);
    }
}


// CRITICAL: Initialize the data fetch on page load
document.addEventListener('DOMContentLoaded', initialLoad);

// Event Handlers for Loan Search
BRANCH_SELECT.addEventListener('change', handleBranchSelectChange);
LOAN_SELECT.addEventListener('change', handleLoanSelectChange);
SEARCH_BUTTON.addEventListener('click', displayLoanRecord);
ADVOCATE_FEE_TOGGLE.addEventListener('change', toggleAdvocateFeeBlocks);


function handleBranchSelectChange() {
    const selectedBranch = BRANCH_SELECT.value;
    if (selectedBranch) {
        const loans = ALL_RECORDS
            .filter(record => record['Loan Branch'] === selectedBranch)
            .map(record => record['Loan No'])
            .sort();
        populateLoanDropdown(loans);
        LOAN_SELECT.disabled = false;
        // Clear previous view
        DATA_BLOCKS_CONTAINER.innerHTML = '';
        NOT_FOUND_MESSAGE.style.display = 'none';
        window.CURRENT_LOAN_RECORD = null;
    } else {
        populateLoanDropdown([]);
    }
}

function handleLoanSelectChange() {
    SEARCH_BUTTON.disabled = !LOAN_SELECT.value;
    DATA_BLOCKS_CONTAINER.innerHTML = '';
    NOT_FOUND_MESSAGE.style.display = 'none';
    window.CURRENT_LOAN_RECORD = null;
}

function toggleAdvocateFeeBlocks() {
    const show = ADVOCATE_FEE_TOGGLE.checked;
    
    // Find blocks 5 and 6 and toggle their visibility
    const blocks = DATA_BLOCKS_CONTAINER.querySelectorAll('.data-block');
    blocks.forEach(block => {
        const header = block.querySelector('.block-header h3').textContent;
        if (header.startsWith('5)') || header.startsWith('6)')) {
            block.style.display = show ? 'block' : 'none';
        }
    });
}


function displayLoanRecord() {
    const selectedLoan = LOAN_SELECT.value;
    const selectedRecord = ALL_RECORDS.find(record => record['Loan No'] === selectedLoan);
    
    DATA_BLOCKS_CONTAINER.innerHTML = '';
    NOT_FOUND_MESSAGE.style.display = 'none';
    window.CURRENT_LOAN_RECORD = null;
    
    if (selectedRecord) {
        window.CURRENT_LOAN_RECORD = selectedRecord;
        
        // 1. Render all data blocks
        renderDataBlocks(selectedRecord);
        
        // 2. Apply toggle state
        toggleAdvocateFeeBlocks();

    } else {
        NOT_FOUND_MESSAGE.textContent = `Loan No. ${selectedLoan} not found in the loaded data.`;
        NOT_FOUND_MESSAGE.style.display = 'block';
    }
}

// FIX 1: New function to load loan details from the tracker table click
function viewLoanDetailsFromTracker(loanNo) {
    const record = ALL_RECORDS.find(r => r['Loan No'] === loanNo);

    if (record) {
        // 1. Set the Branch dropdown
        BRANCH_SELECT.value = record['Loan Branch'];
        
        // 2. Re-populate loan dropdown for the selected branch to ensure the option exists
        handleBranchSelectChange(); // This function already exists and will populate LOAN_SELECT
        
        // 3. Set the Loan dropdown to the selected loan
        LOAN_SELECT.value = loanNo;
        
        // 4. Manually trigger the display of the loan record
        displayLoanRecord();
        
        // Optional: Scroll to the data view section
        document.getElementById('data-view-blocks').scrollIntoView({ behavior: 'smooth' });
    } else {
        alert(`Loan ${loanNo} details could not be found.`);
    }
}

// Function to render the entire data view
function renderDataBlocks(record) {
    let blocksHtml = '';

    // Loop through defined blocks
    DISPLAY_BLOCKS.forEach(blockDef => {
        let blockContent = '';
        let isFourColumn = blockDef.title.startsWith('5)') || blockDef.title.startsWith('6)');
        let hasTotal = blockDef.title.startsWith('5)') || blockDef.title.startsWith('6)');
        
        // Build individual field rows
        for (const [backendKey, displayLabel] of Object.entries(blockDef.fields)) {
            let value = record[backendKey];
            
            // Format dates
            if (DATE_FIELDS.includes(backendKey)) {
                value = formatDate(value);
            }
            
            // Format numbers (Amounts) - exclude non-amount fields if needed
            if (['Loan Amount', 'EMI', 'Arrear Amount', 'Loan Balance'].includes(backendKey) || 
                backendKey.toLowerCase().includes('fee') || backendKey.toLowerCase().includes('charge') || 
                backendKey.toLowerCase().includes('expense') || backendKey.toLowerCase().includes('tds') || 
                backendKey.toLowerCase().includes('amt')) {
                value = formatCurrency(value);
            }
            
            // Apply critical highlighting
            let valueClass = '';
            if (CRITICAL_FIELDS.includes(backendKey) && (parseNumber(record[backendKey]) > 0 || String(value).trim() !== 'N/A')) {
                valueClass = 'critical-value';
            }
            
            // Apply minus-value class for TDS (deductions)
            if (backendKey.toLowerCase().includes('tds')) {
                valueClass += ' minus-value';
            }
            
            blockContent += `
                <div class="data-block-item">
                    <span class="item-label">${displayLabel}:</span>
                    <span class="item-value ${valueClass}">${value || 'N/A'}</span>
                </div>
            `;
        }
        
        // Add Subtotals for Blocks 5 and 6
        if (hasTotal) {
            const is138 = blockDef.title.startsWith('5)');
            const definitions = is138 ? CHARGE_DEFINITIONS_138 : CHARGE_DEFINITIONS_09;
            
            // 1. Advocate Fee Net (Fees - TDS)
            const feeNet = calculateAdvocateFeePaymentNet(record, definitions.AdvocateFeeNetFields);
            blockContent += `
                <div class="data-block-item advocate-fee-net subtotal-row">
                    <span class="item-label">Advocate Fee Net:</span>
                    <span class="item-value">${formatCurrency(feeNet)}</span>
                </div>
            `;
            
            // 2. Other Charges Net
            const otherChargesNet = calculateChargesNet(record, definitions.OtherChargesFields);
            blockContent += `
                <div class="data-block-item other-charges-net subtotal-row">
                    <span class="item-label">Other Charges Net:</span>
                    <span class="item-value">${formatCurrency(otherChargesNet)}</span>
                </div>
            `;
            
            // 3. Section Grand Total (Advocate Fee Net + Other Charges Net)
            const grandTotal = feeNet + otherChargesNet;
            blockContent += `
                <div class="data-block-item block-total-net subtotal-row">
                    <span class="item-label">${blockDef.title.replace(/\d\)/, 'Section')} TOTAL CHARGES:</span>
                    <span class="item-value">${formatCurrency(grandTotal)}</span>
                </div>
            `;
        }

        // Final Block structure with accordion controls
        blocksHtml += `
            <div class="data-block">
                <div class="block-header accordion-header expanded">
                    <h3>${blockDef.title}</h3>
                    <span class="accordion-icon">▶</span>
                </div>
                <div class="data-block-content-wrapper accordion-content expanded">
                    <div class="data-block-content ${isFourColumn ? 'four-column' : ''}">
                        ${blockContent}
                    </div>
                </div>
            </div>
        `;
    });

    DATA_BLOCKS_CONTAINER.innerHTML = blocksHtml;

    // Attach accordion listeners
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', function() {
            this.classList.toggle('expanded');
            const contentWrapper = this.nextElementSibling;
            contentWrapper.classList.toggle('expanded');
        });
    });
}


// ====================================================================
// 4. ADVOCATE TRACKER LOGIC 
// ====================================================================

// Helper to determine CSS class for status tag
function getStatusClassName(status) {
    const s = String(status).toLowerCase();
    if (s === 'paid') return 'status-paid';
    if (s === 'processing') return 'status-processing';
    if (s === 'rejected') return 'status-rejected';
    return 'status-unset';
}

// ADDED paymentField to arguments AND ensured it's in the icon's data attributes
function revertToTag(tdElement, newStatus, loanNo, advocateName, paymentField) { 
    const statusClass = getStatusClassName(newStatus);
    
    // CRITICAL: Ensure paymentField is present in the icon's data attributes
    const htmlContent = ` 
        <div class="status-tag ${statusClass}"> ${newStatus} 
            <span class="edit-icon" data-loan-no="${loanNo}" data-advocate="${advocateName}" data-current-status="${newStatus}" data-payment-field="${paymentField}" title="Click to edit status (password required)"> ✍️ Edit </span> 
        </div> 
    `;
    
    if (tdElement) {
        tdElement.innerHTML = htmlContent;
        // Re-attach listener to the newly created Edit icon
        const editIcon = tdElement.querySelector('.edit-icon');
        if (editIcon) {
            editIcon.addEventListener('click', function() {
                showPasscodePopup(this);
            });
        }
        return;
    }
    // Used during initial table render
    return htmlContent;
}

// 4.1. Handle the initial click (The password step)
function showPasscodePopup(iconElement) {
    const loanNo = iconElement.dataset.loanNo;
    const currentStatus = iconElement.dataset.currentStatus;
    const tdElement = iconElement.closest('.status-cell');
    const advocateName = iconElement.dataset.advocate;
    const paymentField = iconElement.dataset.paymentField; // CRITICAL: Get payment field from icon
    
    // 1. Ask for password
    const password = prompt("Enter password to change status:");
    
    if (password === CLIENT_SIDE_AUTH_KEY) {
        // 2. Password accepted, enable edit
        // ADDED paymentField
        enableStatusDropdown(tdElement, loanNo, currentStatus, advocateName, paymentField);
    } else if (password !== null && password !== '') {
        alert("Incorrect password. Status update aborted.");
    }
}

// ---------- UPDATED enableStatusDropdown (uses paymentField) ----------
function enableStatusDropdown(tdElement, loanNo, currentStatus, advocateName, paymentField) {
    if (!tdElement || !paymentField) return;

    // 1. Build the dropdown options
    let optionsHtml = STATUS_OPTIONS.map(status => {
        const selected = status === currentStatus ? 'selected' : '';
        return `<option value="${status}" ${selected}>${status}</option>`;
    }).join('');
    
    // 2. Construct the form HTML
    // Note: The select name is the backend column (e.g., '138 Payment')
    const formHtml = `
        <form class="status-update-form" data-loan-no="${loanNo}" data-advocate="${advocateName}">
            <select name="${paymentField}" class="status-select">
                ${optionsHtml}
            </select>
            <button type="submit" class="submit-status-button">Save</button>
            <button type="button" class="cancel-status-button">Cancel</button>
        </form>
        <span class="update-message"></span>
    `;
    
    tdElement.innerHTML = formHtml;

    // 3. Attach event listeners to the new elements
    const form = tdElement.querySelector('.status-update-form');
    form.addEventListener('submit', function(event) {
        event.preventDefault();
        const newStatus = this.querySelector('.status-select').value;
        submitStatusUpdate(this, newStatus, loanNo, advocateName, paymentField, tdElement, currentStatus);
    });

    const cancelButton = tdElement.querySelector('.cancel-status-button');
    cancelButton.addEventListener('click', function() {
        // Revert to the previous status tag (use the original status for the cancel)
        revertToTag(tdElement, currentStatus, loanNo, advocateName, paymentField);
    });
}
// ----------------------------------------------------------------------------


// Function to handle submission of status update
async function submitStatusUpdate(formElement, newStatus, loanNo, advocateName, paymentField, tdElement, originalStatus) {
    const updateMessage = tdElement.querySelector('.update-message');
    updateMessage.textContent = 'Submitting...';
    
    // Show immediate working state in the cell
    tdElement.querySelector('.status-select').disabled = true;
    tdElement.querySelector('.submit-status-button').disabled = true;
    
    const requestBody = {
        authKey: CLIENT_SIDE_AUTH_KEY,
        "Loan No": loanNo,
        "ADVOCATE": advocateName, // This is the identifier for the backend function 
        [paymentField]: newStatus // The actual field to update: '138 Payment' or 'sec9 Payment'
    };
    
    try {
        // Assuming API_URL is used for POST requests to your Netlify function (or similar backend)
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();

        if (result.status === 'success') {
            
            // 1. Provide IMEDIATE visual success feedback
            updateMessage.textContent = '✅ Saved! Refreshing table...';
            
            // 2. Update the local ALL_RECORDS object (Crucial for the refresh)
            const recordToUpdate = ALL_RECORDS.find(r => 
                String(r['Loan No']).trim() === String(loanNo).trim()
            );

            if (recordToUpdate) {
                // Update the correct payment field in the local cache
                recordToUpdate[paymentField] = newStatus;
            }

            // 3. Re-render the Advocate Payments View to reflect the change IMMEDIATELY
            const selectedAdvocate = ADVOCATE_TRACKER_SELECT.value;
            const filteredRecords = ALL_RECORDS.filter(record => 
                String(record['ADVOCATE']).trim() === selectedAdvocate || 
                String(record['Sec/9 Advocate']).trim() === selectedAdvocate
            );
            
            // REMOVED setTimeout: Call display immediately for instant update
            displayAdvocatePaymentSummary(filteredRecords, selectedAdvocate); 

        } else {
            updateMessage.textContent = `❌ Error: ${result.message || 'Server error'}`;
            // Revert on error
            revertToTag(tdElement, originalStatus, loanNo, advocateName, paymentField); // Pass paymentField on revert
        }

    } catch (error) {
        updateMessage.textContent = '❌ Network Error. Status update failed.';
        console.error("Error submitting status:", error);
        // Revert on network error
        revertToTag(tdElement, originalStatus, loanNo, advocateName, paymentField); // Pass paymentField on revert
    }
}
// ----------------------------------------------------------------------------


// Function to generate the payment summary and display it
function displayAdvocatePaymentSummary(records, advocateName) {
    // Check if the new DOM elements exist (must be in index.html)
    if (!ADVOCATE_PAYMENT_SNAPSHOT_BOX || !ADVOCATE_PAYMENTS_TABLE_CONTAINER) {
         ADVOCATE_PAYMENTS_VIEW.innerHTML = '<p style="color:red;">Error: Required summary elements (advocate-payment-snapshot-box and advocate-payments-table-container) are missing from index.html.</p>';
         return;
    }
    
    ADVOCATE_TRACKER_INITIAL_MESSAGE.style.display = 'none';
    ADVOCATE_PAYMENTS_TABLE_CONTAINER.innerHTML = '';
    ADVOCATE_PAYMENT_SNAPSHOT_BOX.innerHTML = '';
    ADVOCATE_PAYMENT_SNAPSHOT_BOX.classList.add('loan-snapshot-box'); 
    ADVOCATE_PAYMENT_SNAPSHOT_BOX.style.display = 'flex'; 

    // 1. Calculate and render Snapshot/Total Box (Total Fee Net)
    const totalFeeNet = calculateAdvocateTotalNetFee(records, advocateName);
    
    const totalHtml = `
        <div class="snapshot-item total-color">
            <span class="label">Total Fee Net (Across ${records.length} Loans)</span>
            <span class="value">${formatCurrency(totalFeeNet)}</span>
        </div>
        <div class="snapshot-item primary">
            <span class="label">Advocate Name</span>
            <span class="value">${advocateName}</span>
        </div>
        <div class="snapshot-item success">
            <span class="label">Total Loans Tracked</span>
            <span class="value">${records.length}</span>
        </div>
    `;
    
    ADVOCATE_PAYMENT_SNAPSHOT_BOX.innerHTML = totalHtml;
    
    // 2. Render the Detailed Loans Table
    let tableHtml = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Loan No</th>
                    <th>Customer Name</th>
                    <th>Total Fee Net</th>
                    <th>Current Payment Status (Fetched)</th> 
                    <th>${STATUS_FIELD} (Edit Only)</th> 
                </tr>
            </thead>
            <tbody>
    `;

    records.forEach(record => {
        const loanNo = record['Loan No'];
        const customerName = record['Customer Name'];
        // const loanDate = formatDate(record['Loandate']); // LOAN DATE REMOVED
        
        let netFee = 0;
        let paymentField = ''; // The field to be updated in the backend (e.g., '138 Payment')
        let section = 'N/A';
        
        const is138Advocate = String(record['ADVOCATE']).trim() === String(advocateName).trim();
        const isSec9Advocate = String(record['Sec/9 Advocate']).trim() === String(advocateName).trim();
        
        // Determine the relevant section and fee calculation
        if (is138Advocate && isSec9Advocate) {
             // If advocate is associated with both, calculate combined net fee for display
             netFee = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields) +
                      calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
             section = '138 & 09';
             // CRITICAL: For editing, default to 138 if both apply, as this is often the primary action.
             paymentField = '138 Payment'; 
        } else if (is138Advocate) {
            netFee = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields);
            paymentField = '138 Payment';
            section = 'Sec. 138';
        } else if (isSec9Advocate) {
            netFee = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
            paymentField = 'sec9 Payment';
            section = 'Sec. 09';
        }
        
        const feeDisplay = `${formatCurrency(netFee)} (${section})`;
        // The current status fetched from the backend for the *specific* payment field
        const currentStatus = getAdvocatePaymentStatusForTracker(record, advocateName); 
        
        // COLUMN 4: The cell for the currently recorded status (Static display near Fee Net)
        const currentStatusTag = `<span class="status-tag ${getStatusClassName(currentStatus)}">${currentStatus}</span>`;

        // COLUMN 5: The cell for the editable status (Dropdown/Edit Button)
        // CRITICAL: Pass paymentField to revertToTag
        const editableCellHtml = revertToTag(null, currentStatus, loanNo, advocateName, paymentField);

        tableHtml += `
            <tr data-loan-no="${loanNo}">
                <td class="loan-no-cell" onclick="viewLoanDetailsFromTracker('${loanNo}')" style="cursor: pointer; font-weight: bold; color: var(--color-primary);">${loanNo}</td>
                <td>${customerName}</td>
                <td>${feeDisplay}</td>
                <td>${currentStatusTag}</td>
                <td class="status-cell" data-payment-field="${paymentField}">${editableCellHtml}</td>
            </tr>
        `;
    });

    tableHtml += `</tbody></table>`;
    ADVOCATE_PAYMENTS_TABLE_CONTAINER.innerHTML = tableHtml;

    // Re-attach listeners for the new Edit icons
    ADVOCATE_PAYMENTS_TABLE_CONTAINER.querySelectorAll('.edit-icon').forEach(icon => {
        icon.addEventListener('click', function() { 
            showPasscodePopup(this); 
        });
    });
}

// Event listener for the Advocate Tracker dropdown (Hooking up the logic)
ADVOCATE_TRACKER_SELECT.addEventListener('change', handleAdvocateSelectChange);

function handleAdvocateSelectChange() {
    const selectedAdvocate = ADVOCATE_TRACKER_SELECT.value;
    
    if (!selectedAdvocate) {
        ADVOCATE_TRACKER_INITIAL_MESSAGE.style.display = 'block';
        ADVOCATE_PAYMENTS_TABLE_CONTAINER.innerHTML = '';
        if (ADVOCATE_PAYMENT_SNAPSHOT_BOX) ADVOCATE_PAYMENT_SNAPSHOT_BOX.style.display = 'none';
        return;
    }
    
    const filteredRecords = ALL_RECORDS.filter(record => {
        const is138Advocate = String(record['ADVOCATE']).trim() === selectedAdvocate;
        const isSec9Advocate = String(record['Sec/9 Advocate']).trim() === selectedAdvocate;
        return is138Advocate || isSec9Advocate;
    });
    
    if (filteredRecords.length > 0) {
        displayAdvocatePaymentSummary(filteredRecords, selectedAdvocate);
    } else {
        ADVOCATE_PAYMENTS_VIEW.innerHTML = `<p>No payment records found for Advocate: <strong>${selectedAdvocate}</strong>.</p>`;
    }
}


// ====================================================================
// 5. WRITE OPERATION: Handles form submission (Existing code)
// ====================================================================

// Add Loan No. field to the form submission logic for identification
FORM.addEventListener('submit', async function(event) {
    event.preventDefault();
    
    const headerName = HEADER_INPUT.value.trim();
    const dataValue = DATA_INPUT.value.trim();
    const loanNo = LOAN_SELECT.value;

    if (!window.CURRENT_LOAN_RECORD || !loanNo) {
        MESSAGE_ELEMENT.textContent = '❌ Error: Please select a loan first.';
        return;
    }

    MESSAGE_ELEMENT.textContent = 'Submitting data...';
    
    // IMPORTANT: Check if the user is trying to overwrite a critical field.
    if (['Loan No', 'ADVOCATE', 'Sec/9 Advocate', 'Loan Branch'].includes(headerName)) {
        MESSAGE_ELEMENT.textContent = '❌ Critical Error: Cannot overwrite core fields like Loan No, ADVOCATE, etc.';
        return;
    }

    // Prepare the data payload for the server
    const requestBody = {
        authKey: AUTH_KEY_INPUT.value, // Send the user-entered password for server side check
        "Loan No": loanNo,
        [headerName]: dataValue // Dynamic column update
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();

        if (result.status === 'success') {
            MESSAGE_ELEMENT.textContent = `✅ Record successfully saved! Column: ${headerName}. Reloading data...`;
            FORM.reset(); 
            // Reload all data to ensure the main table and tracker are updated
            initialLoad(); 
        } else {
            // Now displays the error message sent back from the Netlify Function
            MESSAGE_ELEMENT.textContent = `❌ Submission Error: ${result.message || 'Server returned non-success status.'}`;
        }

    } catch (error) {
        console.error("Error submitting data:", error);
        MESSAGE_ELEMENT.textContent = '❌ Network Error. Could not submit data.';
    }
});


// ====================================================================
// 6. TOGGLE WRITE FORM (Helper for input button)
// ====================================================================

function showInputForm() {
    if (AUTH_KEY_INPUT.value === CLIENT_SIDE_AUTH_KEY) {
        FORM.style.display = 'grid'; // Changed to grid to match CSS
        AUTH_BUTTON.style.display = 'none';
        AUTH_KEY_INPUT.style.display = 'none';
        AUTH_LABEL.style.display = 'none';
        MESSAGE_ELEMENT.textContent = 'Input enabled. Select Loan and enter Column Header & Data.';
    } else {
        alert('Incorrect password. Please enter the correct secret key.');
        AUTH_KEY_INPUT.value = '';
    }
}