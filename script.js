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
 * @returns {string} The status value or 'Processing'.
 */
function getAdvocatePaymentStatusForTracker(record, currentAdvocate) {
    if (!record || !currentAdvocate) return 'Processing';
    
    const normalizedAdvocate = String(currentAdvocate).trim();
    
    // If the advocate is the primary 'ADVOCATE' -> Read status from the '138 Payment' column
    if (String(record['ADVOCATE']).trim() === normalizedAdvocate) {
        return record['138 Payment'] || 'Processing';
    } 
    
    // If the advocate is the secondary 'Sec/9 Advocate' -> Read status from the 'sec9 Payment' column
    if (String(record['Sec/9 Advocate']).trim() === normalizedAdvocate) {
        return record['sec9 Payment'] || 'Processing';
    }
    
    return 'Processing'; // Default to processing if advocate is selected but not associated with record
}


// Helper function to format currency for display
function formatCurrency(value) {
    const number = parseNumber(value);
    if (isNaN(number)) return 'N/A';
    return number.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
}

// Function to calculate net total for any group of charges (used for Snapshot Box/Other Charges)
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
 * @param {object} record - The loan record.
 * @param {string[]} feeFields - The list of fields containing fees and TDS (e.g., AdvocateFeeNetFields).
 * @returns {number} The net payment amount.
 */
function calculateAdvocateFeePaymentNet(record, feeFields) {
    let totalNet = 0;
    
    feeFields.forEach(field => {
        const value = parseNumber(record[field]);

        // Logic confirmed to calculate (Initial Fee + Final Fee) - (TDS Initial + TDS Final)
        if (field.includes("TDS")) {
            totalNet -= value; // Subtract TDS
        } else if (!field.includes("GST")) {
            totalNet += value; // Add Fee (but ignore GST, which shouldn't be in these fields anyway)
        }
    });

    return totalNet;
}

/**
 * Calculates the total ADVOCATE FEE NET across both Sec 138 and Sec 09.
 * This is used ONLY for the main snapshot box (total fees owed across all advocates).
 */
function calculateTotalAdvocateFeeNet(record) {
    const feeNet138 = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields);
    const feeNet09 = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
    return feeNet138 + feeNet09;
}

/**
 * NEW CRITICAL HELPER: Calculates the total ADVOCATE FEE NET relevant to the selected advocate for this specific loan.
 * This is used for the tracker's total net column and the matching breakdown total.
 * @param {object} record - The loan record.
 * @param {string} selectedAdvocate - The advocate selected in the dropdown.
 * @returns {number} The net fee (Fees - TDS) for the sections the advocate handles for this loan.
 */
function calculateNetFeeForSelectedAdvocate(record, selectedAdvocate) {
    let netFee = 0;
    const normalizedAdvocate = String(selectedAdvocate).trim();

    // 1. Check if the advocate is the primary 'ADVOCATE' (Sec 138)
    if (String(record['ADVOCATE'] || '').trim() === normalizedAdvocate) {
        netFee += calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields);
    } 
    
    // 2. Check if the advocate is the secondary 'Sec/9 Advocate'
    // Note: An advocate can be both (handling both sections), so we use '+' and don't use 'else if'.
    if (String(record['Sec/9 Advocate'] || '').trim() === normalizedAdvocate) {
        netFee += calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
    }
    
    return netFee;
}


// --- CHARGE FIELD DEFINITIONS FOR BLOCKS 5 & 6 ---
// Map Sheet Headers to a cleaner, more professional display name
const FEE_FIELD_MAP = {
    // 138 Fees
    "Initial Fee for Sec.138": "Initial Fee",
    "GST of Sec.138 Initial Fee": "GST (Initial)",
    "TDS of Sec.138 Initial Fee": "TDS (Initial)",
    "Final fee for Sec 138": "Final Fee",
    "GST of Final fee for Sec 138": "GST (Final)",
    "TDS of Final fee for Sec 138": "TDS (Final)",
    // 09 Fees
    "Initial Fee for Sec 09": "Initial Fee",
    "GST of Sec 09 Initial Fee": "GST (Initial)",
    "TDS of Initial Fee": "TDS (Initial)", // Note: Sheet name for Sec 09 TDS Initial is slightly different
    "Final Fee For Sec 09": "Final Fee",
    "GST of Final Fee For Sec 09": "GST (Final)",
    "TDS of Final Fee For Sec 09": "TDS (Final)", // Note: Sheet name for Sec 09 TDS Final is slightly different
};

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
    // Other Charges Net Group (Included in Block 5 total but separate from Advocate Fee Net)
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
    // Other Charges Net Group (Included in Block 6 total but separate from Advocate Fee Net)
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

// --- DISPLAY CONFIGURATION (All Fields) ---
const DISPLAY_BLOCKS = [
// ... (DISPLAY_BLOCKS remains unchanged)
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
const SNAPSHOT_BOX = document.getElementById('loan-snapshot-box');
const HEADER_INPUT = document.getElementById('header_name'); 
const DATA_INPUT = document.getElementById('data_value');
const ADVOCATE_FEE_CONTROLS = document.getElementById('advocate-fee-controls');
const ADVOCATE_FEE_TOGGLE = document.getElementById('advocate-fee-toggle');

// Elements for Advocate Tracker
const ADVOCATE_TRACKER_SELECT = document.getElementById('advocate-tracker-select');
const ADVOCATE_PAYMENTS_VIEW = document.getElementById('advocate-payments-view');


// ====================================================================
// 3. DROPDOWN POPULATION & CORE LOGIC
// ====================================================================

/**
 * REQUIRED FIX: Defines the function called by initialLoad.
 */
function populateBranchDropdown(branches) {
    BRANCH_SELECT.innerHTML = '<option value="">-- Select Branch --</option>';
    branches.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch;
        option.textContent = branch;
        BRANCH_SELECT.appendChild(option);
    });
}

/**
 * REQUIRED FIX: Defines the function called by initialLoad.
 */
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
 * This is now defined AFTER the functions it calls.
 */
async function initialLoad() {
    LOADING_STATUS.textContent = 'Loading all data from server...';
    LOADING_STATUS.style.display = 'block';
    
    try {
        const response = await fetch(API_URL);
        const result = await response.json();
        
        if (result.status === 'success') {
            ALL_RECORDS = result.data;
            const branches = [...new Set(ALL_RECORDS.map(record => record['Loan Branch']).filter(b => b))];
            
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

// All other functions and event listeners should follow here:
// ====================================================================

// ====================================================================
// 4. ADVOCATE TRACKER LOGIC
// ====================================================================

// Helper to determine CSS class for status tag
function getStatusClassName(status) {
    const s = status.toLowerCase();
    if (s === 'paid') return 'status-paid';
    if (s === 'processing') return 'status-processing';
    if (s === 'rejected') return 'status-rejected';
    return 'status-unset';
}

/**
 * Helper to retrieve the total fee net from the record relevant to the selected advocate.
 * Used for the table's Total Fee Net column display.
 * * FIX: Now takes selectedAdvocate and uses the new specific calculation helper.
 */
function getRecordFeeNet(loanNo, selectedAdvocate) {
    const record = ALL_RECORDS.find(r => String(r["Loan No"]).trim() === loanNo);
    if (!record || !selectedAdvocate) return 0;
    
    // Use the dedicated helper function for selected advocate net calculation
    return calculateNetFeeForSelectedAdvocate(record, selectedAdvocate);
}


// Function to generate the HTML for the status tag (does NOT update the DOM)
function revertToTag(tdElement, newStatus, loanNo, advocateName) {
    const statusClass = getStatusClassName(newStatus);
    
    // HTML content for the disabled tag with the Edit option
    const htmlContent = `
        <div class="status-tag ${statusClass}">
            ${newStatus}
            <span class="edit-icon" 
                  data-loan-no="${loanNo}" 
                  data-advocate="${advocateName}" 
                  data-current-status="${newStatus}"
                  title="Click to edit status (password required)">
                ✍️ Edit
            </span>
        </div>
    `;

    // Only return the HTML. The calling function handles DOM insertion and listener setup.
    return htmlContent;
}

/**
 * Function to reconstruct the entire combined status/fee <td> content.
 * Used for initial rendering, and for reverting/confirming status changes.
 * * FIX: Now takes selectedAdvocate and passes it to getRecordFeeNet.
 */
function revertToCombinedCell(tdElement, newStatus, loanNo, advocateName) {
    // CRITICAL: Ensure this is the correct Net Fee calculation
    const totalFeeNet = getRecordFeeNet(loanNo, advocateName);
    const statusTagHTML = revertToTag(null, newStatus, loanNo, advocateName);

    const htmlContent = `
        <div class="status-fee-wrapper">
            <div class="status-display-area">
                ${statusTagHTML}
            </div>
            
            <div class="fee-net-area">
                <button class="breakdown-button" 
                        data-loan-no="${loanNo}" 
                        data-advocate="${advocateName}"
                        onclick="showFeeBreakdown(this)">
                    ${formatCurrency(totalFeeNet)}
                </button>
            </div>
        </div>
    `;

    if (tdElement) {
        tdElement.innerHTML = htmlContent;
        
        // Re-attach listeners to the newly created Edit icon
        const editIcon = tdElement.querySelector('.edit-icon');
        if (editIcon) {
            editIcon.addEventListener('click', function() {
                showPasscodePopup(this);
            });
        }
        return;
    }

    // If tdElement is null, return the full HTML content for initial table generation
    return htmlContent;
}


// 4.1. Handle the initial click (The password step)
function showPasscodePopup(iconElement) {
    const loanNo = iconElement.dataset.loanNo;
    const currentStatus = iconElement.dataset.currentStatus;
    // The closest parent with status-cell class is the target TD
    const tdElement = iconElement.closest('.status-cell'); 
    const advocateName = iconElement.dataset.advocate;

    // 1. Ask for password
    const password = prompt("Enter password to change status:");

    if (password === CLIENT_SIDE_AUTH_KEY) { 
        // 2. Password accepted, enable edit
        enableStatusDropdown(tdElement, loanNo, currentStatus, advocateName);
    } else if (password !== null && password !== '') { 
        alert("Incorrect password. Status update aborted.");
    }
}

// ---------- helper: sanitize a string to a safe DOM id ----------
function toSafeId(str) {
  if (str === undefined || str === null) return '';
  return String(str).trim().replace(/[^A-Za-z0-9\-_]/g, '_'); // only letters, numbers, dash, underscore
}

// ---------- new enableStatusDropdown (build elements & listeners safely) ----------
function enableStatusDropdown(tdElement, loanNo, currentStatus, advocateName) {
    // ensure tdElement exists
    if (!tdElement) return;

    const safeLoanId = toSafeId(loanNo);
    const selectId = `status-select-${safeLoanId}`;
    const cellId = `status-cell-${safeLoanId}`;

    // create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'status-edit-mode';

    // dropdown
    const select = document.createElement('select');
    select.id = selectId;
    select.className = 'status-select';
    select.dataset.originalStatus = currentStatus || '';
    select.dataset.loanNo = loanNo;
    select.dataset.advocate = advocateName || '';

    // Ensure STATUS_OPTIONS is defined somewhere else in your script.
    if (Array.isArray(STATUS_OPTIONS)) {
      STATUS_OPTIONS.forEach(opt => {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt;
          if (opt === currentStatus) o.selected = true;
          select.appendChild(o);
      });
    } else {
      // fallback: add currentStatus as a single option if STATUS_OPTIONS missing
      const o = document.createElement('option');
      o.value = currentStatus || 'Processing';
      o.textContent = currentStatus || 'Processing';
      select.appendChild(o);
    }

    // buttons container
    const btnWrap = document.createElement('div');
    btnWrap.className = 'status-buttons';

    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'status-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async function (evt) {
        // show saving (temporarily replaces content)
        tdElement.innerHTML = `<div class="status-fee-wrapper"><span class="status-saving">Saving...</span></div>`;
        // get selected value
        const newStatus = select.value;

        try {
            // Pass the current advocate name to the save function
            await confirmSaveStatus(loanNo, newStatus, tdElement, advocateName); 
        } catch (err) {
            console.error('Unexpected error in save click:', err);
            // Revert on failure
            revertToCombinedCell(tdElement, select.dataset.originalStatus || 'Processing', loanNo, advocateName);
        }
    });

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'status-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function () {
        // Revert to original status and full cell structure
        revertToCombinedCell(tdElement, select.dataset.originalStatus || 'Processing', loanNo, advocateName);
    });

    btnWrap.appendChild(saveBtn);
    btnWrap.appendChild(cancelBtn);
    wrapper.appendChild(select);
    wrapper.appendChild(btnWrap);
    
    tdElement.id = cellId;
    tdElement.innerHTML = ''; // clear old contents
    tdElement.appendChild(wrapper);
}

// ---------- CORRECTED confirmSaveStatus (CRITICAL) ----------
// MODIFICATION: Accepts advocateName to correctly determine the column to update.
async function confirmSaveStatus(loanNo, newStatus, tdElement, currentAdvocate) {
    const sel = tdElement.querySelector('.status-select');
    const originalStatus = (sel && sel.dataset && sel.dataset.originalStatus) ? sel.dataset.originalStatus : 'Processing';
    
    if (!newStatus || newStatus === originalStatus) {
        revertToCombinedCell(tdElement, originalStatus, loanNo, currentAdvocate);
        return;
    }

    // --- CRITICAL FIX: Determine the actual COLUMN HEADER ---
    const record = ALL_RECORDS.find(r => String(r["Loan No"]).trim() === String(loanNo).trim());
    let targetColumn = '';
    
    if (record) {
        const normalizedAdvocate = currentAdvocate.trim();
        // 1. If the current advocate is the primary 'ADVOCATE' (Sec 138), use '138 Payment'
        if (String(record['ADVOCATE']).trim() === normalizedAdvocate) {
            targetColumn = '138 Payment'; 
        } 
        // 2. If the current advocate is the secondary 'Sec/9 Advocate' (Sec 09), use 'sec9 Payment'
        else if (String(record['Sec/9 Advocate']).trim() === normalizedAdvocate) {
            targetColumn = 'sec9 Payment'; 
        }
    }

    if (!targetColumn) {
        // Use originalStatus and currentAdvocate to revert the cell
        revertToCombinedCell(tdElement, originalStatus, loanNo, currentAdvocate);
        alert("Error: Cannot determine the correct payment column. Update aborted.");
        return;
    }

    // 2. Build the payload using the determined actual column header (targetColumn)
    const dataToSend = {
        // This will be {"138 Payment": "New Status"} or {"sec9 Payment": "New Status"}
        [targetColumn]: newStatus,
        "Loan No": loanNo,
        "ADVOCATE_ID": currentAdvocate, // FIX: Use ADVOCATE_ID for backend compatibility
        "authKey": (typeof CLIENT_SIDE_AUTH_KEY !== 'undefined') ? CLIENT_SIDE_AUTH_KEY : ''
    };

    try {
        // Saving status is already set in enableStatusDropdown's save listener
        const response = await fetch(API_URL, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(dataToSend)
        });

        const result = await response.json();

        if (result && result.status === 'success') {
            // FIX APPLIED: Update the UI to the new status and restore the full cell structure.
            revertToCombinedCell(tdElement, newStatus, loanNo, currentAdvocate);
        } else {
            alert(`❌ Status update failed: ${result.message}`);
            revertToCombinedCell(tdElement, originalStatus, loanNo, currentAdvocate);
        }
    } catch (error) {
        console.error('Error saving status:', error);
        alert('❌ Network or server error during update. Check console.');
        revertToCombinedCell(tdElement, originalStatus, loanNo, currentAdvocate);
    }
}

// 4.5. ADVOCATE TRACKER DISPLAY LOGIC (MODIFIED for Combined Status/Fee)
ADVOCATE_TRACKER_SELECT.addEventListener('change', () => displayAdvocateSummary(ADVOCATE_TRACKER_SELECT.value));

function displayAdvocateSummary(selectedAdvocate) {
    if (!selectedAdvocate) {
        ADVOCATE_PAYMENTS_VIEW.innerHTML = '<p>Select an Advocate to see their payment summary.</p>';
        return;
    }

    const filteredRecords = ALL_RECORDS.filter(record => 
        String(record["ADVOCATE"] || '').trim() === selectedAdvocate || 
        String(record["Sec/9 Advocate"] || '').trim() === selectedAdvocate 
    );

    if (filteredRecords.length === 0) {
        ADVOCATE_PAYMENTS_VIEW.innerHTML = `<p>No payment records found for Advocate: ${selectedAdvocate}.</p>`;
        return;
    }

    let tableHTML = `
        <table class="advocate-summary-table">
            <thead>
                <tr>
                    <th>Loan No</th>
                    <th>Branch</th>
                    <th>Customer Name</th>
                    <th>Sections</th>
                    <th class="right-align">Payment Status / Total Fee Net (Click for Breakdown)</th>
                </tr>
            </thead>
            <tbody>
    `;

    let grandTotalNet = 0;

    filteredRecords.forEach(record => {
        const loanNo = record["Loan No"];
        const branchName = record["Loan Branch"] || 'N/A'; // New Branch Field
        const custName = record["Customer Name"] || 'N/A';
        
        // Use the helper to get the status relevant to the current advocate/section
        const statusValue = getAdvocatePaymentStatusForTracker(record, selectedAdvocate);

        // FIX: Pass selectedAdvocate to getRecordFeeNet to calculate only relevant fees
        const totalFeeNet = getRecordFeeNet(loanNo, selectedAdvocate); 
        grandTotalNet += totalFeeNet;

        const sections = [];
        if (String(record["ADVOCATE"] || '').trim() === selectedAdvocate) sections.push("Sec 138");
        if (String(record["Sec/9 Advocate"] || '').trim() === selectedAdvocate) sections.push("Sec 09");

        tableHTML += `
            <tr id="row-${loanNo}">
                <td data-label="Loan No">${loanNo}</td>
                <td data-label="Branch">${branchName}</td>
                <td data-label="Customer Name">${custName}</td>
                <td data-label="Sections">${sections.join(' & ')}</td>
                <td data-label="Status & Total Net" id="status-cell-${loanNo}" class="status-cell combined-status-fee-cell">
                    ${revertToCombinedCell(null, statusValue, loanNo, selectedAdvocate)}
                </td>
            </tr>
            <tr id="breakdown-row-${loanNo}" class="fee-breakdown-row" style="display: none;">
                <td colspan="5"></td>
            </tr>
        `;
    });

    tableHTML += `
        <tr class="grand-total-row">
            <td colspan="4" style="text-align: right; font-weight: 700;">GRAND TOTAL (NET FEE ONLY):</td>
            <td style="font-weight: 700; color: var(--color-primary);">${formatCurrency(grandTotalNet)}</td>
        </tr>
        </tbody>
        </table>
    `;

    ADVOCATE_PAYMENTS_VIEW.innerHTML = tableHTML;
}

// ====================================================================
// 5. FEE BREAKDOWN POPUP LOGIC (FIXED for consistency)
// ====================================================================

/**
 * Hides the fee breakdown row.
 */
function hideFeeBreakdown(breakdownRow) {
    if (breakdownRow) {
        breakdownRow.style.display = 'none';
        breakdownRow.querySelector('td').innerHTML = '';
    }
}

/**
 * Generates and displays the fee breakdown for a specific loan.
 * CRITICAL FIX: Ensures the final TOTAL FEE NET calculation is consistent and only shows
 * relevant sections for the selected advocate.
 */
function showFeeBreakdown(buttonElement) {
    const loanNo = buttonElement.dataset.loanNo;
    const selectedAdvocate = buttonElement.dataset.advocate; // Get advocate name from the button
    const record = ALL_RECORDS.find(r => String(r["Loan No"]).trim() === loanNo);
    const breakdownRow = document.getElementById(`breakdown-row-${loanNo}`);
    const breakdownCell = breakdownRow.querySelector('td');

    if (!record) {
        alert("Loan record not found for breakdown.");
        return;
    }
    
    // Toggle logic: If the row is already open, close it.
    if (breakdownRow.style.display === 'table-row') {
         hideFeeBreakdown(breakdownRow);
         return;
    }
    
    // Determine which sections the selected advocate handles for this loan
    const isSec138Advocate = String(record['ADVOCATE'] || '').trim() === selectedAdvocate.trim();
    const isSec09Advocate = String(record['Sec/9 Advocate'] || '').trim() === selectedAdvocate.trim();

    // --- Start HTML Generation for Breakdown ---
    let breakdownHTML = `
        <div class="fee-breakdown-content">
            <h3>Fee & Charges Breakdown for Loan No: ${loanNo} (Advocate: ${selectedAdvocate})</h3>
    `;

    // 1. Section 138 Breakdown (Only if selected advocate is the 138 advocate)
    if (isSec138Advocate) {
        breakdownHTML += `
            <div class="breakdown-section" id="breakdown-sec-138">
                <h4>Section 138 Fees & Charges</h4>
                <div class="data-block-content four-column">
        `;

        // 1.1. Calculate and display 138 Advocate Fees
        let sec138FeeTotal = 0;
        CHARGE_DEFINITIONS_138.AdvocateFeeFieldsDisplay.forEach(field => {
            const value = parseNumber(record[field]);
            const displayValue = formatCurrency(value);
            const displayName = FEE_FIELD_MAP[field] || field;
            const className = field.includes("TDS") ? 'minus-value' : '';
            
            breakdownHTML += `
                <div class="data-label">${displayName}:</div>
                <div class="data-value ${className}">${displayValue}</div>
            `;
            
            // Summing the total fees (Fees + GST - TDS) for section subtotal
            let sign = 1;
            if (field.includes("TDS")) sign = -1;
            sec138FeeTotal += value * sign;
        });

        // 1.2. Display 138 Other Charges 
        const sec138OtherChargesNet = calculateChargesNet(record, CHARGE_DEFINITIONS_138.OtherChargesFields);
        breakdownHTML += `
            <div class="data-label">Other Charges (Sec 138 Net):</div>
            <div class="data-value">${formatCurrency(sec138OtherChargesNet)}</div>
        `;
        sec138FeeTotal += sec138OtherChargesNet;
        
        // 1.3. Section 138 Subtotal (Gross total)
        breakdownHTML += `
            <div class="data-label subtotal-row" style="font-weight: bold;">SEC 138 TOTAL (Fees + GST + Other Charges - TDS):</div>
            <div class="data-value subtotal-row" style="font-weight: bold;">${formatCurrency(sec138FeeTotal)}</div>
            <hr class="subtotal-separator" style="grid-column: span 2;">
        `;
        
        // 1.4. Section 138 Net Fee Only (Fees - TDS, no GST, no Other Charges)
        const sec138FeeNetOnly = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields);
        breakdownHTML += `
            <div class="data-label net-row" style="font-weight: bold; color: var(--color-primary);">SEC 138 FEE NET (Fees - TDS):</div>
            <div class="data-value net-row" style="font-weight: bold; color: var(--color-primary);">${formatCurrency(sec138FeeNetOnly)}</div>
            <hr style="grid-column: span 2;">
            </div>
            </div>
        `;
    }

    // 2. Section 09 Breakdown (Only if selected advocate is the Sec 09 advocate)
    if (isSec09Advocate) {
        breakdownHTML += `
            <div class="breakdown-section" id="breakdown-sec-09">
                <h4>Section 09 Fees & Charges</h4>
                <div class="data-block-content four-column">
        `;
        
        let sec09FeeTotal = 0;
        CHARGE_DEFINITIONS_09.AdvocateFeeFieldsDisplay.forEach(field => {
            const value = parseNumber(record[field]);
            const displayValue = formatCurrency(value);
            const displayName = FEE_FIELD_MAP[field] || field;
            const className = field.includes("TDS") ? 'minus-value' : '';
            
            breakdownHTML += `
                <div class="data-label">${displayName}:</div>
                <div class="data-value ${className}">${displayValue}</div>
            `;
            
            // Summing the total fees (Fees + GST - TDS) for section subtotal
            let sign = 1;
            if (field.includes("TDS")) sign = -1;
            sec09FeeTotal += value * sign;
        });

        // 2.2. Display 09 Other Charges 
        const sec09OtherChargesNet = calculateChargesNet(record, CHARGE_DEFINITIONS_09.OtherChargesFields);
        breakdownHTML += `
            <div class="data-label">Other Charges (Sec 09 Net):</div>
            <div class="data-value">${formatCurrency(sec09OtherChargesNet)}</div>
        `;
        sec09FeeTotal += sec09OtherChargesNet;

        // 2.3. Section 09 Subtotal (Gross total)
        breakdownHTML += `
            <div class="data-label subtotal-row" style="font-weight: bold;">SEC 09 TOTAL (Fees + GST + Other Charges - TDS):</div>
            <div class="data-value subtotal-row" style="font-weight: bold;">${formatCurrency(sec09FeeTotal)}</div>
            <hr class="subtotal-separator" style="grid-column: span 2;">
        `;
        
        // 2.4. Section 09 Net Fee Only (Fees - TDS, no GST, no Other Charges)
        const sec09FeeNetOnly = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
        breakdownHTML += `
            <div class="data-label net-row" style="font-weight: bold; color: var(--color-primary);">SEC 09 FEE NET (Fees - TDS):</div>
            <div class="data-value net-row" style="font-weight: bold; color: var(--color-primary);">${formatCurrency(sec09FeeNetOnly)}</div>
            <hr style="grid-column: span 2;">
            </div>
            </div>
        `;
    }

    // 3. FINAL TOTAL NET CALCULATION (CRITICAL FIX FOR USER ISSUE)
    // This MUST use the same logic as the button text: calculateNetFeeForSelectedAdvocate
    const totalFeeNetCalc = calculateNetFeeForSelectedAdvocate(record, selectedAdvocate);
    
    breakdownHTML += `
        <div class="final-total-section">
            <h4 class="final-total-header">Total Advocate Fee Summary for ${selectedAdvocate}</h4>
            <div class="data-block-content two-column">
                <div class="data-label final-net-row" style="font-weight: 700;">TOTAL FEE NET (Fees - TDS):</div>
                <div class="data-value final-net-row" id="section-net-total-fee-only" style="font-weight: 700; color: var(--color-success); font-size: 1.1em;">
                    ${formatCurrency(totalFeeNetCalc)}
                </div>
            </div>
            <p style="font-style: italic; margin-top: 10px;">Note: The Total Fee Net (Fees - TDS) should match the amount in the Advocate Tracker Table.</p>
        </div>
        <button onclick="hideFeeBreakdown(this.closest('.fee-breakdown-row'))">Close Breakdown</button>
        </div>
    `;

    // --- End HTML Generation for Breakdown ---

    breakdownCell.innerHTML = breakdownHTML;
    breakdownRow.style.display = 'table-row';
    // Scroll to the breakdown
    breakdownRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


// ====================================================================
// 6. LOAN DETAIL SEARCH LOGIC
// ====================================================================

// Helper function to render a single data block
function renderDataBlock(title, fields, record) {
    let html = `
        <div class="data-block">
            <h3>${title}</h3>
            <div class="data-block-content">
    `;
    
    for (const sheetField in fields) {
        const displayLabel = fields[sheetField];
        let displayValue = record[sheetField] || 'N/A';
        
        // Apply date formatting
        if (DATE_FIELDS.includes(sheetField)) {
            displayValue = formatDate(displayValue);
        }
        
        // Apply currency formatting to known money fields (Block 5/6)
        if (title.includes("Fee & Charges")) {
             // Only format if a number can be parsed
            if (!isNaN(parseNumber(record[sheetField]))) {
                 displayValue = formatCurrency(record[sheetField]);
            }
        }
        
        // Apply highlighting for critical fields
        let valueClass = '';
        if (CRITICAL_FIELDS.includes(sheetField)) {
            valueClass = 'critical-value';
        }

        html += `
            <div class="data-label">${displayLabel}:</div>
            <div class="data-value ${valueClass}">${displayValue}</div>
        `;
    }
    
    html += `
            </div>
        </div>
    `;
    return html;
}

// Function to calculate and display the loan snapshot
function renderLoanSnapshot(record) {
    const loanBalance = parseNumber(record['Loan Balance']);
    const arrearAmount = parseNumber(record['Arrear Amount']);
    // NOTE: This intentionally shows the total fee net for *all* advocates for the overall loan summary.
    const totalAdvocateFeeNet = calculateTotalAdvocateFeeNet(record); 
    const totalAdvocateFeeGross138 = calculateChargesNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeFieldsDisplay);
    const totalAdvocateFeeGross09 = calculateChargesNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeFieldsDisplay);
    const totalAdvocateFeeGross = totalAdvocateFeeGross138 + totalAdvocateFeeGross09;


    SNAPSHOT_BOX.innerHTML = `
        <div class="snapshot-item">
            <span class="snapshot-label">Loan Balance:</span>
            <span class="snapshot-value">${formatCurrency(loanBalance)}</span>
        </div>
        <div class="snapshot-item">
            <span class="snapshot-label">Arrear Amount:</span>
            <span class="snapshot-value critical-value">${formatCurrency(arrearAmount)}</span>
        </div>
        <div class="snapshot-item">
            <span class="snapshot-label">Total Advocate Fee (Gross):</span>
            <span class="snapshot-value">${formatCurrency(totalAdvocateFeeGross)}</span>
        </div>
        <div class="snapshot-item total-net-item">
            <span class="snapshot-label">Total Advocate Fee (Net):</span>
            <span class="snapshot-value">${formatCurrency(totalAdvocateFeeNet)}</span>
        </div>
    `;
    SNAPSHOT_BOX.style.display = 'flex';
}

function displayRecordDetails(record) {
    // Hide not found message
    NOT_FOUND_MESSAGE.style.display = 'none';
    
    // Clear previous content
    DATA_BLOCKS_CONTAINER.innerHTML = '';
    
    // Render the loan snapshot box
    renderLoanSnapshot(record);

    // Render all blocks
    DISPLAY_BLOCKS.forEach(block => {
        const blockHTML = renderDataBlock(block.title, block.fields, record);
        DATA_BLOCKS_CONTAINER.innerHTML += blockHTML;
    });

    DATA_VIEW_SECTION.style.display = 'block';
}

function searchLoanDetails() {
    const selectedLoanNo = LOAN_SELECT.value;
    
    if (!selectedLoanNo) {
        // Clear view and return if no loan selected
        DATA_VIEW_SECTION.style.display = 'none';
        SNAPSHOT_BOX.style.display = 'none';
        NOT_FOUND_MESSAGE.style.display = 'block';
        NOT_FOUND_MESSAGE.textContent = 'Please select a Loan Number.';
        return;
    }

    const record = ALL_RECORDS.find(r => String(r["Loan No"]).trim() === selectedLoanNo);

    if (record) {
        // Store the current record globally for potential updates
        window.CURRENT_LOAN_RECORD = record; 
        displayRecordDetails(record);
    } else {
        DATA_VIEW_SECTION.style.display = 'none';
        SNAPSHOT_BOX.style.display = 'none';
        NOT_FOUND_MESSAGE.textContent = `Loan No. ${selectedLoanNo} not found in the loaded data.`;
        NOT_FOUND_MESSAGE.style.display = 'block';
    }
}


// Event Listeners for Search
BRANCH_SELECT.addEventListener('change', (e) => {
    const selectedBranch = e.target.value;
    const loans = ALL_RECORDS
        .filter(record => record['Loan Branch'] === selectedBranch)
        .map(record => record['Loan No'])
        .filter(loanNo => loanNo)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    LOAN_SELECT.innerHTML = '<option value="">-- Select Loan No --</option>';
    loans.forEach(loanNo => {
        const option = document.createElement('option');
        option.value = loanNo;
        option.textContent = loanNo;
        LOAN_SELECT.appendChild(option);
    });
    
    // Reset view when branch changes
    DATA_VIEW_SECTION.style.display = 'none';
    SNAPSHOT_BOX.style.display = 'none';
    NOT_FOUND_MESSAGE.style.display = 'none';
    LOAN_SELECT.value = '';
});

SEARCH_BUTTON.addEventListener('click', searchLoanDetails);
LOAN_SELECT.addEventListener('change', searchLoanDetails);


// ====================================================================
// 7. WRITE FORM LOGIC
// ====================================================================

// Event Listener for the main submission form (Department A write)
FORM.addEventListener('submit', async (e) => {
    e.preventDefault();

    const selectedLoan = LOAN_SELECT.value;
    const headerName = HEADER_INPUT.value;
    const dataValue = DATA_INPUT.value;

    if (!selectedLoan || !headerName) {
        MESSAGE_ELEMENT.textContent = 'Please select a Loan and enter a Column Header.';
        return;
    }
    
    // Simple confirmation before sending
    if (!confirm(`Are you sure you want to set the value of column "${headerName}" to "${dataValue}" for Loan No. ${selectedLoan}?`)) {
        return;
    }

    MESSAGE_ELEMENT.textContent = 'Submitting data...';

    const dataToSend = {
        "Loan No": selectedLoan,
        [headerName]: dataValue,
        "authKey": (typeof CLIENT_SIDE_AUTH_KEY !== 'undefined') ? CLIENT_SIDE_AUTH_KEY : ''
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(dataToSend)
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
// 7. TOGGLE WRITE FORM (Helper for input button)
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