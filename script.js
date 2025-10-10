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
 * NEW HELPER: Calculates the total ADVOCATE FEE NET across both Sec 138 and Sec 09.
 * This is used for the main snapshot box to align with the tracker's requirement.
 */
function calculateTotalAdvocateFeeNet(record) {
    const feeNet138 = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields);
    const feeNet09 = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
    return feeNet138 + feeNet09;
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

// =ITICAL: Initialize the data fetch on page load
document.addEventListener('DOMContentLoaded', initialLoad);

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
 * Helper to retrieve the total fee net from the record.
 * Used when reconstructing the combined cell after an edit.
 * CRITICAL: This now correctly only uses Fees - TDS.
 */
function getRecordFeeNet(loanNo) {
    const record = ALL_RECORDS.find(r => String(r["Loan No"]).trim() === loanNo);
    if (!record) return 0;
    
    // Calculate Net Fee for Sec 138 (Fees - TDS)
    const feeNet138 = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields);
    // Calculate Net Fee for Sec 09 (Fees - TDS)
    const feeNet09 = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
    
    // Return the total net fee for all sections.
    return feeNet138 + feeNet09;
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
 */
function revertToCombinedCell(tdElement, newStatus, loanNo, advocateName) {
    // CRITICAL: Ensure this is the correct Net Fee calculation
    const totalFeeNet = getRecordFeeNet(loanNo);
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
            await confirmSaveStatus(loanNo, newStatus, tdElement); // pass DOM tdElement
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
// MODIFICATION: Uses revertToCombinedCell to restore the full cell structure.

async function confirmSaveStatus(loanNo, newStatus, tdElement) {
    const sel = tdElement.querySelector('.status-select');
    const originalStatus = (sel && sel.dataset && sel.dataset.originalStatus) ? sel.dataset.originalStatus : 'Processing';
    
    // Get advocate name from the global filtering dropdown
    const currentAdvocate = (typeof ADVOCATE_TRACKER_SELECT !== 'undefined' && ADVOCATE_TRACKER_SELECT && ADVOCATE_TRACKER_SELECT.value) ? ADVOCATE_TRACKER_SELECT.value : '';

    if (!newStatus || newStatus === originalStatus) {
        revertToCombinedCell(tdElement, originalStatus, loanNo, currentAdvocate);
        return;
    }

    // --- CRITICAL FIX: Determine the actual COLUMN HEADER ---
    const record = ALL_RECORDS.find(r => String(r["Loan No"]).trim() === String(loanNo).trim());
    let targetColumn = '';
    
    if (record) {
        const normalizedAdvocate = currentAdvocate.trim();
        
        // 1. If the current advocate is the primary 'ADVOCATE' (BO), use '138 Payment'
        if (String(record['ADVOCATE']).trim() === normalizedAdvocate) {
            targetColumn = '138 Payment'; // <-- FIX: Use actual BO column header
        } 
        // 2. If the current advocate is the secondary 'Sec/9 Advocate' (BP), use 'sec9 Payment'
        else if (String(record['Sec/9 Advocate']).trim() === normalizedAdvocate) {
            targetColumn = 'sec9 Payment'; // <-- FIX: Use actual BP column header
        }
    }
    
    if (!targetColumn) {
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
            headers: { 'Content-Type': 'application/json' }, 
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
        
        // Calculate Net Fee for Sec 138 (Fees - TDS)
        const feeNet138 = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields);
        // Calculate Net Fee for Sec 09 (Fees - TDS)
        const feeNet09 = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
        
        // Combine both net fees for the grand total and display
        const totalFeeNet = feeNet138 + feeNet09;
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
                <td colspan="5"></td> </tr>
        `;
    });

    tableHTML += `
            <tr class="grand-total-row">
                <td colspan="4" style="text-align: right; font-weight: 700;">GRAND TOTAL (NET FEE ONLY):</td>
                <td style="font-weight: 700; color: var(--color-primary);" class="right-align">${formatCurrency(grandTotalNet)}</td>
            </tr>
        </tbody>
    </table>
    `;

    ADVOCATE_PAYMENTS_VIEW.innerHTML = tableHTML;
    
    // Re-attach listeners for the Edit Icons
    document.querySelectorAll('.edit-icon').forEach(icon => {
        icon.addEventListener('click', function() {
            showPasscodePopup(this);
        });
    });

    LOADING_STATUS.textContent = `Summary loaded for ${selectedAdvocate}. ${filteredRecords.length} records found.`;
}

// 4.6. NEW FUNCTION: Show Fee Breakdown (MODIFIED)
function showFeeBreakdown(buttonElement) {
    const loanNo = buttonElement.dataset.loanNo;
    const advocateName = buttonElement.dataset.advocate;
    const breakdownRow = document.getElementById(`breakdown-row-${loanNo}`);
    const record = ALL_RECORDS.find(r => String(r["Loan No"]).trim() === loanNo);

    if (!record) return;

    // Toggle display of the breakdown row
    if (breakdownRow.style.display === 'table-row') {
        breakdownRow.style.display = 'none';
        buttonElement.classList.remove('active');
        return;
    }

    // Hide any other open breakdown rows
    document.querySelectorAll('.fee-breakdown-row').forEach(row => {
        if (row.id !== `breakdown-row-${loanNo}`) {
            row.style.display = 'none';
        }
    });
    document.querySelectorAll('.breakdown-button').forEach(btn => btn.classList.remove('active'));


    buttonElement.classList.add('active');
    breakdownRow.style.display = 'table-row';
    
    const breakdownCell = breakdownRow.querySelector('td');
    
    let breakdownHTML = `<div class="breakdown-container">`;
    
    // Helper function to render a single fee section (MODIFIED for structure and content)
    const renderFeeSection = (sectionTitle, definitions, isAdvocateForSection) => {
        if (!isAdvocateForSection) return '';

        // 1. Prepare data and calculate totals
        const gstFields = definitions.AdvocateFeeFieldsDisplay.filter(f => f.includes("GST"));
        
        let totalFee = 0;
        let totalTDS = 0;
        let totalGST = 0;
        
        // --- Build Section HTML ---
        let sectionHTML = `
            <div class="breakdown-section">
                <h4>${sectionTitle} - TOTAL FEE NET CALCULATION</h4>
                <table class="fee-breakdown-table">
        `;
        
        const getRecordValue = (field) => parseNumber(record[field]);

        // Priority order: Final Fee, Initial Fee, TDS Final, TDS Initial
        let finalFeeField = definitions === CHARGE_DEFINITIONS_138 ? "Final fee for Sec 138" : "Final Fee For Sec 09";
        let initialFeeField = definitions === CHARGE_DEFINITIONS_138 ? "Initial Fee for Sec.138" : "Initial Fee for Sec 09";
        let tdsFinalField = definitions === CHARGE_DEFINITIONS_138 ? "TDS of Final fee for Sec 138" : "TDS of Final Fee For Sec 09";
        let tdsInitialField = definitions === CHARGE_DEFINITIONS_138 ? "TDS of Sec.138 Initial Fee" : "TDS of Initial Fee";
        
        // Use crisp display names and filter out zero-value fields
        const orderedFields = [
            { field: finalFeeField, type: 'fee', displayName: 'Final Fee' },
            { field: initialFeeField, type: 'fee', displayName: 'Initial Fee' },
            { field: tdsFinalField, type: 'tds', displayName: 'TDS (Final)' },
            { field: tdsInitialField, type: 'tds', displayName: 'TDS (Initial)' },
        ].filter(item => record[item.field] !== undefined && getRecordValue(item.field) > 0); 
        
        // --- 1. FEES and TDS (The main payment group) ---
        orderedFields.forEach(item => {
            const field = item.field;
            const value = getRecordValue(field);
            const displayName = item.displayName; 

            if (item.type === 'tds') {
                totalTDS += value;
                sectionHTML += `
                    <tr class="deduction">
                        <td>(-) ${displayName}</td>
                        <td class="right-align">${formatCurrency(value)}</td>
                    </tr>
                `;
            } else { // It's a fee field
                totalFee += value;
                sectionHTML += `
                    <tr>
                        <td>${displayName}</td>
                        <td class="right-align">${formatCurrency(value)}</td>
                    </tr>
                `;
            }
        });
        
        // --- Total Fee Net Line ---
        const totalNetFeeOnly = totalFee - totalTDS;
        sectionHTML += `
            <tr class="section-net-total-fee-only">
                <td><strong>TOTAL FEE NET (Fees - TDS):</strong></td>
                <td class="right-align"><strong>${formatCurrency(totalNetFeeOnly)}</strong></td>
            </tr>
            <tr><td colspan="2" class="separator"></td></tr>
        `;

        // --- GST (for reference only) ---
        sectionHTML += `<tr class="group-header gst-header"><td colspan="2">GST COMPONENTS (For Reference Only)</td></tr>`;
        gstFields.filter(field => getRecordValue(field) > 0).forEach(field => { // Only show non-zero GST
            const value = getRecordValue(field);
            totalGST += value;
            sectionHTML += `
                <tr class="gst-row">
                    <td>${FEE_FIELD_MAP[field] || field}</td>
                    <td class="right-align">${formatCurrency(value)}</td>
                </tr>
            `;
        });
        
        // The total net for the section is simply totalNetFeeOnly.
        sectionHTML += `</table></div>`;
        return sectionHTML;
    };
    
    // --- SEC 138 FEES ---
    const isAdvocate138 = String(record["ADVOCATE"] || '').trim() === advocateName;
    breakdownHTML += renderFeeSection("Section 138 Fees & Charges", CHARGE_DEFINITIONS_138, isAdvocate138);

    // --- SEC 09 FEES ---
    const isAdvocate09 = String(record["Sec/9 Advocate"] || '').trim() === advocateName;
    breakdownHTML += renderFeeSection("Section 09 Fees & Charges", CHARGE_DEFINITIONS_09, isAdvocate09);

    breakdownHTML += `</div>`;
    breakdownCell.innerHTML = breakdownHTML;
}


// ====================================================================
// 5. LOAN DETAILS DISPLAY LOGIC
// ====================================================================

BRANCH_SELECT.addEventListener('change', populateLoanDropdown);
LOAN_SELECT.addEventListener('change', () => {
    SEARCH_BUTTON.disabled = !LOAN_SELECT.value;
    LOADING_STATUS.textContent = 'Click "Display Loan Data"';
});

function populateLoanDropdown() {
    const selectedBranch = BRANCH_SELECT.value;
    LOAN_SELECT.innerHTML = '<option value="" selected disabled>-- Select Loan No --</option>';
    LOAN_SELECT.disabled = true;
    SEARCH_BUTTON.disabled = true;

    if (!selectedBranch) {
        return;
    }

    const loans = ALL_RECORDS
        .filter(record => String(record["Loan Branch"] || '').trim() === selectedBranch)
        .map(record => String(record["Loan No"] || '').trim());

    const uniqueLoans = new Set(loans);

    [...uniqueLoans].sort().forEach(loanNo => {
        const option = document.createElement('option');
        option.value = loanNo;
        option.textContent = loanNo;
        LOAN_SELECT.appendChild(option);
    });

    LOAN_SELECT.disabled = false;
    LOADING_STATUS.textContent = `Loan Nos loaded. Select one.`;
}

SEARCH_BUTTON.addEventListener('click', displayLoan);

function displayLoan() {
    const loanNo = LOAN_SELECT.value;
    const selectedBranch = BRANCH_SELECT.value;
    if (!loanNo || !selectedBranch) {
        LOADING_STATUS.textContent = 'Please select both a Branch and a Loan No.';
        return;
    }

    LOADING_STATUS.textContent = `Displaying data for Loan No: ${loanNo}...`;

    const record = ALL_RECORDS.find(r => 
        String(r["Loan Branch"] || '').trim() === selectedBranch && 
        String(r["Loan No"] || '').trim() === loanNo 
    );

    DATA_VIEW_SECTION.style.display = 'block';
    NOT_FOUND_MESSAGE.style.display = 'none';

    if (record) {
        window.CURRENT_LOAN_RECORD = record;
        renderSnapshot(record);
        
        // FIX: Ensure Sections 5 and 6 are displayed by setting the toggle state before rendering.
        ADVOCATE_FEE_TOGGLE.checked = true; // Set to true to show detailed blocks by default
        
        renderFilteredBlocks(record, ADVOCATE_FEE_TOGGLE.checked);
        
        ADVOCATE_FEE_CONTROLS.style.display = 'flex';
        // CRITICAL FIX: Ensure accordion listeners are added after content is rendered
        addAccordionListeners(); 
        LOADING_STATUS.textContent = `Data loaded for Loan No: ${loanNo}. Click section headers to expand.`;
    } else {
        DATA_BLOCKS_CONTAINER.innerHTML = '';
        SNAPSHOT_BOX.innerHTML = '';
        NOT_FOUND_MESSAGE.textContent = `❌ Error: Selected loan not found in data cache.`;
        NOT_FOUND_MESSAGE.style.display = 'block';
        LOADING_STATUS.textContent = 'Search complete.';
        ADVOCATE_FEE_CONTROLS.style.display = 'none';
    }
}

// Function to format and render the snapshot box (MODIFIED for Advocate Fee Net)
function renderSnapshot(record) {
    SNAPSHOT_BOX.innerHTML = '';

    const getFormattedCurrency = (sheetHeader) => {
        let value = record[sheetHeader] !== undefined ? record[sheetHeader] : 0;
        const number = parseNumber(value);
        if (isNaN(number)) return 'N/A';
        return number.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
    };

    // Use the new helper function for the total, which only includes Fees - TDS.
    const rawTotalAdvocateFeeNet = calculateTotalAdvocateFeeNet(record);
    const formattedTotalAdvocateFeeNet = rawTotalAdvocateFeeNet.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

    const snapshotItems = [
        { header: "Loan Amount", label: "Loan Amount", value: getFormattedCurrency("Loan Amount"), class: 'success' },
        { header: "Loan Balance", label: "Loan Balance", value: getFormattedCurrency("Loan Balance"), class: 'primary' },
        { header: "Arrear Amount", label: "Arrear Amount", value: getFormattedCurrency("Arrear Amount"), class: 'danger' },
        { header: "TOTAL ADVOCATE FEE NET", label: "TOTAL ADVOCATE FEE NET (Fees - TDS)", value: formattedTotalAdvocateFeeNet, class: 'total-color' },
    ];

    let snapshotHTML = '';
    snapshotItems.forEach(item => {
        snapshotHTML += `
            <div class="snapshot-item ${item.class}">
                <span class="label">${item.label}</span>
                <span class="value">${item.value}</span>
            </div>
        `;
    });
    SNAPSHOT_BOX.innerHTML = snapshotHTML;
}

// Helper to render an individual data item
function renderDataItem(sheetHeader, displayName, value) {
// ... (renderDataItem unchanged)
    const item = document.createElement('div');
    item.className = 'data-block-item';

    const label = document.createElement('span');
    label.className = 'item-label';
    label.textContent = `${displayName}:`;

    const dataValue = document.createElement('span');
    dataValue.className = 'item-value';
    dataValue.innerHTML = value; // Use innerHTML for formatted currency spans

    if (CRITICAL_FIELDS.includes(sheetHeader)) {
        dataValue.classList.add('critical-value');
    }

    item.appendChild(label);
    item.appendChild(dataValue);
    return item;
}

// Helper to process and format value
function processValue(record, sheetHeader) {
// ... (processValue unchanged)
    let value = record[sheetHeader] !== undefined ? record[sheetHeader] : 'N/A';

    if (DATE_FIELDS.includes(sheetHeader)) {
        return formatDate(value);
    }

    // Check if the value should be formatted as currency
    if (sheetHeader.includes("Amount") || sheetHeader.includes("Balance") || sheetHeader.includes("Fee") || sheetHeader.includes("Expense") || sheetHeader.includes("Charges") || sheetHeader.includes("Amt") || sheetHeader.includes("TDS") || sheetHeader.includes("GST") || sheetHeader.includes("Paid") || sheetHeader.includes("EMI")) {
        if (value === 'N/A' || value === '' || parseNumber(value) === 0) {
             return 'N/A';
        }
        
        const number = parseNumber(value);
        let displayClass = '';
        if (sheetHeader.includes("TDS")) {
            displayClass = 'minus-value'; // Highlight TDS as deduction
        } else if (sheetHeader.includes("GST")) {
            displayClass = 'gst-value'; // Highlight GST separately
        }

        return `<span class="${displayClass}">${formatCurrency(number)}</span>`;
    }
    
    return String(value);
}

// Helper to render a group of fields
function renderFieldGroup(record, fields, container) {
// ... (renderFieldGroup unchanged)
    for (const sheetHeader in fields) {
        const displayName = fields[sheetHeader];
        const processedValue = processValue(record, sheetHeader);
        
        // Pass the already formatted HTML/String to the renderDataItem helper
        container.appendChild(renderDataItem(sheetHeader, displayName, processedValue));
    }
}

// Function to render the fee/charge subtotals (Blocks 5 and 6)
function renderSubTotals(record, container, definitions, blockTitle) {
    const isSec138 = blockTitle.includes("138");

    // Advocate Fee Net (Fees - TDS, ignoring GST)
    const advocateFeeNet = calculateAdvocateFeePaymentNet(record, definitions.AdvocateFeeNetFields);
    // Other Charges Net (Charges - TDS, if any)
    const otherChargesNet = calculateChargesNet(record, definitions.OtherChargesFields);
    const blockTotalNet = advocateFeeNet + otherChargesNet;

    // Advocate Fee Net
    let advocateFeeNetRow = document.createElement('div');
    advocateFeeNetRow.className = 'data-block-item subtotal-row advocate-fee-net';
    advocateFeeNetRow.innerHTML = `
        <span class="item-label">Advocate Fee Net (${isSec138 ? '138' : '09'}) (Fees - TDS):</span>
        <span class="item-value">${formatCurrency(advocateFeeNet)}</span>
    `;
    container.appendChild(advocateFeeNetRow);

    // Other Charges Net
    let otherChargesNetRow = document.createElement('div');
    otherChargesNetRow.className = 'data-block-item subtotal-row other-charges-net';
    otherChargesNetRow.innerHTML = `
        <span class="item-label">Other Charges Net (${isSec138 ? '138' : '09'}):</span>
        <span class="item-value">${formatCurrency(otherChargesNet)}</span>
    `;
    container.appendChild(otherChargesNetRow);

    // Block Total
    let blockTotalNetRow = document.createElement('div');
    blockTotalNetRow.className = 'data-block-item subtotal-row block-total-net';
    blockTotalNetRow.innerHTML = `
        <span class="item-label">TOTAL CHARGES THIS SECTION (NET):</span>
        <span class="item-value">${formatCurrency(blockTotalNet)}</span>
    `;
    container.appendChild(blockTotalNetRow);
}


// Main rendering function that respects the toggle and adds 4-column styles
function renderFilteredBlocks(record, showDetailedFees) {
// ... (renderFilteredBlocks content remains the same)
    DATA_BLOCKS_CONTAINER.innerHTML = '';

    DISPLAY_BLOCKS.forEach((block, index) => {
        const isFeeBlock = index === 4 || index === 5;
        
        // Keep Fee Blocks (5 & 6) visible only if the toggle is checked
        if (isFeeBlock && !showDetailedFees) {
            return;
        }

        const blockElement = document.createElement('div');
        blockElement.className = 'data-block';
        
        // Blocks 1, 3, 5, 6 require 4-column layout (index 0, 2, 4, 5)
        const isFourColumn = index === 0 || index === 2 || index === 4 || index === 5;

        const header = document.createElement('div');
        header.className = 'block-header accordion-header';
        header.innerHTML = `<h3>${block.title}</h3><span class="accordion-icon">▶</span>`;

        const contentWrapper = document.createElement('div');
        // All blocks start collapsed by default, controlled by maxHeight: null in JS
        contentWrapper.className = `data-block-content-wrapper accordion-content`; 
        
        const content = document.createElement('div');
        content.className = `data-block-content ${isFourColumn ? 'four-column' : ''}`;
        
        renderFieldGroup(record, block.fields, content);

        if (isFeeBlock) {
            const definitions = index === 4 ? CHARGE_DEFINITIONS_138 : CHARGE_DEFINITIONS_09;
            renderSubTotals(record, content, definitions, block.title);
        }

        contentWrapper.appendChild(content);
        blockElement.appendChild(header);
        blockElement.appendChild(contentWrapper);
        DATA_BLOCKS_CONTAINER.appendChild(blockElement);
    });
}

// --- NEW/RE-ADDED ACCORDION LOGIC START ---

// Function to handle the accordion toggle logic
function toggleAccordion(event) {
    const header = event.currentTarget;
    // The next sibling is the data-block-content-wrapper (which has the accordion-content class)
    const content = header.nextElementSibling; 
    const icon = header.querySelector('.accordion-icon');

    if (content.style.maxHeight) {
        // Collapse: if maxHeight is set (i.e., it's currently open)
        content.style.maxHeight = null;
        icon.textContent = '▶';
    } else {
        // Expand
        // Collapse all others (optional, but good UX for accordions)
        document.querySelectorAll('.accordion-content').forEach(activeContent => {
            if (activeContent !== content && activeContent.style.maxHeight) {
                activeContent.style.maxHeight = null;
                // Find the previous sibling (the header) to update its icon
                activeContent.previousElementSibling.querySelector('.accordion-icon').textContent = '▶';
            }
        });

        // Set maxHeight to scrollHeight for a smooth transition effect
        content.style.maxHeight = content.scrollHeight + "px"; 
        icon.textContent = '▼';
    }
}


// Function to attach listeners to all accordion headers
function addAccordionListeners() {
    const headers = document.querySelectorAll('.accordion-header');
    headers.forEach(header => {
        // Since renderFilteredBlocks clears and rebuilds the content, 
        // we can simply add the listener, knowing it's a fresh element.
        header.addEventListener('click', toggleAccordion);
    });
}

// --- NEW/RE-ADDED ACCORDION LOGIC END ---

// Toggle functionality for Blocks 5 & 6
ADVOCATE_FEE_TOGGLE.addEventListener('change', () => {
    if (window.CURRENT_LOAN_RECORD) {
        renderFilteredBlocks(window.CURRENT_LOAN_RECORD, ADVOCATE_FEE_TOGGLE.checked);
        addAccordionListeners();
    }
});


// ====================================================================
// 6. WRITE OPERATION (General Data Update)
// ====================================================================

FORM.addEventListener('submit', async function(event) {
// ... (form submission logic unchanged)
    event.preventDefault();
    MESSAGE_ELEMENT.textContent = 'Submitting...';

    const keyToSubmit = AUTH_KEY_INPUT.value;
    const headerName = HEADER_INPUT.value.trim();
    const dataValue = DATA_INPUT.value;
    
    if (!keyToSubmit || !headerName || !dataValue) {
        MESSAGE_ELEMENT.textContent = '❌ Error: All fields are required.';
        return;
    }

    if (!LOAN_SELECT.value) {
        // CRITICAL CHECK: Ensure a loan is selected before trying to save
        MESSAGE_ELEMENT.textContent = '❌ Error: Please select a Loan No. first.';
        return;
    }

    const dataToSend = {};
    dataToSend[headerName] = dataValue; 
    dataToSend["Loan No"] = LOAN_SELECT.value; // Loan No for row targeting
    dataToSend["ADVOCATE_ID"] = ADVOCATE_TRACKER_SELECT.value; // FIX: Use ADVOCATE_ID for backend compatibility
    dataToSend["authKey"] = keyToSubmit; 

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            mode: 'cors', 
            headers: {
                'Content-Type': 'application/json',
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