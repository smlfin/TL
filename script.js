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

// --- CHARGE FIELD DEFINITIONS FOR BLOCKS 5 & 6 ---
// (Your CHARGE_DEFINITIONS_138, CHARGE_DEFINITIONS_09, and CHARGE_FIELDS_FOR_SNAPSHOT definitions go here)

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
// e.g., showInputForm(), handleLoanSelectChange(), displayLoanRecord(), 
// ====================================================================

// ====================================================================
// 2. CORE FUNCTIONS (Initial Fetch)
// ====================================================================

/**
 * CORE FUNCTION: Fetches all data and initializes the application.
 * Place the full content of your initialLoad function here.
 * NOTE: This function must be defined before the DOMContentLoaded listener.
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
// ====================================================================
// 3. WRITE OPERATION: Handles POST requests (Data Submission) - FINAL FIX FOR TWO ADVOCATE COLUMNS
// ====================================================================
function doPost(e) {
  try {
    const raw = e.postData && e.postData.contents ? e.postData.contents : '{}';
    const requestData = JSON.parse(raw);

    // AUTH CHECK
    if (requestData.authKey !== SECRET_WRITE_KEY) {
      const errorData = { status: 'error', message: 'Authorization failed. Invalid secret key.' };
      return sendJson_(errorData, null);
    }
    
    // CRITICAL: We require Loan No AND ADVOCATE field (the name of the person being paid)
    const loanNo = requestData["Loan No"];
    const advocateName = requestData["ADVOCATE"]; 
    
    if (!loanNo || !advocateName) {
        const missingField = !loanNo ? '"Loan No"' : '"ADVOCATE"';
        const errorData = { status: 'error', message: `Required field ${missingField} is missing for update. Front-end must send Loan No AND the Target Advocate's Name under the key 'ADVOCATE'.` };
        return sendJson_(errorData, null);
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      const errorData = { status: 'error', message: `Sheet named ${SHEET_NAME} not found.` };
      return sendJson_(errorData, null);
    }

    // 1. Get all data and headers
    const range = sheet.getDataRange();
    const values = range.getValues();
    
    if (values.length === 0) {
        const errorData = { status: 'error', message: 'Sheet is empty. Cannot update.' };
        return sendJson_(errorData, null);
    }
    
    const headers = values[0].map(h => (typeof h === 'string' ? h.trim() : h));
    
    // Find the column indices for unique identification
    const loanNoColIndex = headers.findIndex(h => h.toUpperCase() === 'LOAN NO');
    const advocateColIndex = headers.findIndex(h => h.toUpperCase() === 'ADVOCATE');
    const sec9AdvocateColIndex = headers.findIndex(h => h.toUpperCase() === 'SEC/9 ADVOCATE'); // Secondary advocate column

    if (loanNoColIndex === -1 || (advocateColIndex === -1 && sec9AdvocateColIndex === -1)) {
        const missingHeader = loanNoColIndex === -1 ? '"Loan No"' : 'Advocate column';
        const errorData = { status: 'error', message: `Required column ${missingHeader} not found in headers.` };
        return sendJson_(errorData, null);
    }
    
    const normalizedLoanNo = String(loanNo).trim();
    const normalizedAdvocateName = String(advocateName).trim();
    
    // 2. Find the Unique Row Index using Loan No AND a match in EITHER advocate column
    let targetRowIndex = -1;
    for (let i = 1; i < values.length; i++) {
        const rowLoanNo = values[i][loanNoColIndex];
        
        // Check if Loan No matches
        if (rowLoanNo && String(rowLoanNo).trim() === normalizedLoanNo) {
            
            let advocateMatch = false;
            
            // Check the primary ADVOCATE column
            if (advocateColIndex !== -1) {
                const rowAdvocateName = values[i][advocateColIndex];
                if (rowAdvocateName && String(rowAdvocateName).trim() === normalizedAdvocateName) {
                    advocateMatch = true;
                }
            }
            
            // Check the secondary Sec/9 Advocate column
            if (!advocateMatch && sec9AdvocateColIndex !== -1) {
                const rowSec9AdvocateName = values[i][sec9AdvocateColIndex];
                if (rowSec9AdvocateName && String(rowSec9AdvocateName).trim() === normalizedAdvocateName) {
                    advocateMatch = true;
                }
            }
            
            if (advocateMatch) {
                // targetRowIndex is the row number in the sheet (1-based)
                targetRowIndex = i + 1; 
                break;
            }
        }
    }
    
    if (targetRowIndex === -1) {
        const errorData = { status: 'error', message: `Record for Loan No ${loanNo} and Advocate ${advocateName} not found in sheet. Check spelling and case.` };
        return sendJson_(errorData, null);
    }
    
    // 3. Update the specific fields
    const updatedFields = [];
    
    for (const field of Object.keys(requestData)) {
        // Skip keys used for identification
        if (field === 'authKey' || field === 'Loan No' || field === 'ADVOCATE') continue;
        
        const colIndex = headers.findIndex(h => h === field);
        
        if (colIndex !== -1) {
            // Column index in the sheet is 1-based, so colIndex + 1
            const cellRange = sheet.getRange(targetRowIndex, colIndex + 1);
            cellRange.setValue(requestData[field]);
            updatedFields.push(field);
        } else {
            Logger.log(`WARNING: Field "${field}" not found in sheet headers.`);
        }
    }

    if (updatedFields.length === 0) {
        const errorData = { status: 'error', message: 'No recognized fields provided for update.' };
        return sendJson_(errorData, null);
    }

    const successData = { status: 'success', message: `Record ${loanNo} for Advocate ${advocateName} updated successfully for fields: ${updatedFields.join(', ')}.` };
    return sendJson_(successData, null);

  } catch (error) {
    Logger.log("POST Error: " + error.toString());
    const errorData = { status: 'error', message: error.toString() };
    return sendJson_(errorData, null);
  }
}

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

// Function to convert the cell content back to the disabled tag (Final State)
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

    // 1. Ask for password
    const password = prompt("Enter password to change status:");

    if (password === CLIENT_SIDE_AUTH_KEY) { 
        // 2. Password accepted, enable edit
        enableStatusDropdown(tdElement, loanNo, currentStatus, advocateName);
    } else if (password !== null && password !== '') { 
        alert("Incorrect password. Status update aborted.");
    }
}

// 4.2. Replace tag with dropdown and buttons
function enableStatusDropdown(tdElement, loanNo, currentStatus, advocateName) {
    let selectHTML = `<div class="status-edit-mode">`;
    
    // Dropdown for status selection
    selectHTML += `<select id="status-select-${loanNo}" class="status-select" data-original-status="${currentStatus}">`;
    
    STATUS_OPTIONS.forEach(option => {
        const isSelected = option === currentStatus ? 'selected' : '';
        selectHTML += `<option value="${option}" ${isSelected}>${option}</option>`;
    });

    selectHTML += `</select>`;
    
    // Add Save and Cancel buttons
    selectHTML += `
        <div class="status-buttons">
            <button class="status-save-btn" onclick="confirmSaveStatus('${loanNo}', document.getElementById('status-select-${loanNo}').value, document.getElementById('status-cell-${loanNo}'))">Save</button>
            <button class="status-cancel-btn" onclick="cancelStatusEdit(document.getElementById('status-cell-${loanNo}'), '${currentStatus}', '${loanNo}', '${advocateName}')">Cancel</button>
        </div>
    </div>`;
    
    tdElement.innerHTML = selectHTML;
}

// 4.3. Function to revert to the disabled state without saving
function cancelStatusEdit(tdElement, originalStatus, loanNo, advocateName) {
    revertToTag(tdElement, originalStatus, loanNo, advocateName);
}

// ====================================================================
// 4.4. Save new status and trigger full reload/re-render (With Error Reversion)
// ====================================================================
async function confirmSaveStatus(loanNo, newStatus, tdElement) {
    // Get the original status value for rollback on failure
    const originalStatus = tdElement.querySelector('.status-select').dataset.originalStatus;

    if (newStatus === originalStatus) {
        alert("Status is unchanged. Aborting save.");
        // Assuming cancelStatusEdit reverts the UI element to its original state
        cancelStatusEdit(tdElement, originalStatus, loanNo, ADVOCATE_TRACKER_SELECT.value);
        return;
    }

    if (!newStatus) {
        alert("Please select a valid status.");
        return;
    }

    // Display saving status before API call
    tdElement.innerHTML = `<span class="status-saving">Saving...</span>`;
    
    const headerName = STATUS_FIELD;

    const dataToSend = {
        [headerName]: newStatus,
        "Loan No": loanNo,
        "ADVOCATE": ADVOCATE_TRACKER_SELECT.value, // <--- CRITICAL FIX: Included advocate's name
        "authKey": CLIENT_SIDE_AUTH_KEY
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(dataToSend)
        });

        // --- ENHANCED ERROR CHECK ---
        // 1. Check for bad HTTP status (e.g., 500, 404) before trying to parse JSON.
        if (!response.ok) {
            // Throwing an error here jumps directly to the 'catch' block below
            const errorText = await response.text();
            throw new Error(`Server returned HTTP ${response.status}: ${errorText.substring(0, 100)}...`);
        }
        // -----------------------------

        const result = await response.json();

        if (result.status === 'success') {
            // SUCCESS: The data should now be permanently in the Google Sheet.
            alert(`✅ Status for Loan No ${loanNo} successfully updated to ${newStatus}. The page will now reload all data to confirm the change.`);
            
            // Force a full data re-fetch from the server
            initialLoad();
            
        } else {
            // FAILURE: The server returned a specific error message (e.g., failed to write to sheet).
            alert(`❌ Submission Error for Loan ${loanNo}: ${result.message || 'Server returned non-success status.'}. Status reverted.`);
            // On failure, revert back to the original status tag immediately
            revertToTag(tdElement, originalStatus, loanNo, ADVOCATE_TRACKER_SELECT.value);
        }

    } catch (error) {
        // CATCH: A network connection, timeout, or bad HTTP status error occurred (thrown above).
        console.error("Error saving status:", error);
        alert(`❌ Network or Server Error while saving status for Loan ${loanNo}. Status reverted.`);
        
        // On network/critical failure, revert back to the original status tag
        revertToTag(tdElement, originalStatus, loanNo, ADVOCATE_TRACKER_SELECT.value);
    }
}

// 4.5. ADVOCATE TRACKER DISPLAY LOGIC (MODIFIED for Branch and Clickable Net Fee)
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
                    <th>${STATUS_FIELD}</th>
                    <th class="right-align">Total Fee Net (Click for Breakdown)</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    let grandTotalNet = 0;

    filteredRecords.forEach(record => {
        const loanNo = record["Loan No"];
        const branchName = record["Loan Branch"] || 'N/A'; // New Branch Field
        const custName = record["Customer Name"] || 'N/A';
        const statusValue = record[STATUS_FIELD] || 'Processing'; 
        
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
                <td data-label="Branch">${branchName}</td> <td data-label="Customer Name">${custName}</td>
                <td data-label="Sections">${sections.join(' & ')}</td>
                <td data-label="Status" id="status-cell-${loanNo}" class="status-cell">
                    ${revertToTag(null, statusValue, loanNo, selectedAdvocate)}
                </td>
                <td data-label="Total Net" class="right-align total-net-cell">
                    <button class="breakdown-button" 
                            data-loan-no="${loanNo}" 
                            data-advocate="${selectedAdvocate}"
                            onclick="showFeeBreakdown(this)">
                        ${formatCurrency(totalFeeNet)}
                    </button>
                </td>
            </tr>
            <tr id="breakdown-row-${loanNo}" class="fee-breakdown-row" style="display: none;">
                <td colspan="6"></td>
            </tr>
        `;
    });

    tableHTML += `
            <tr class="grand-total-row">
                <td colspan="5" style="text-align: right; font-weight: 700;">GRAND TOTAL (NET):</td>
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

// 4.6. NEW FUNCTION: Show Fee Breakdown
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
    
    // Helper function to render a single fee section
    const renderFeeSection = (sectionTitle, definitions, isAdvocateForSection) => {
        if (!isAdvocateForSection) return '';

        // 1. Separate fields into groups for clear display
        const feeFields = definitions.AdvocateFeeFieldsDisplay.filter(f => !f.includes("GST") && !f.includes("TDS"));
        const gstFields = definitions.AdvocateFeeFieldsDisplay.filter(f => f.includes("GST"));
        const tdsFields = definitions.AdvocateFeeFieldsDisplay.filter(f => f.includes("TDS"));

        let sectionHTML = `
            <div class="breakdown-section">
                <h4>${sectionTitle}:</h4>
                <div class="calc-note">
                    <span style="color: var(--color-primary); font-weight: 700;">PAYMENT CALCULATION:</span> 
                    (Total Fee) - (Total TDS) = Total Fee Net. **GST is listed separately and is NOT part of the Net Fee.**
                </div>
                <table class="fee-breakdown-table">
        `;
        let totalFee = 0;
        let totalTDS = 0;
        
        // --- 1. FEES COMPONENTS ---
        sectionHTML += `<tr><td colspan="2" style="font-weight: 700; background-color: #f0f0f0; padding-top: 8px; padding-bottom: 8px;">FEE COMPONENTS:</td></tr>`;
        feeFields.forEach(field => {
            const value = parseNumber(record[field]);
            totalFee += value;

            sectionHTML += `
                <tr>
                    <td>${field.replace(/for Sec\..*|For Sec.*|Initial Fee|Final fee/g, "").trim() + ' Fee'}</td>
                    <td class="right-align">${formatCurrency(value)}</td>
                </tr>
            `;
        });
        
        sectionHTML += `
            <tr class="section-fees-total">
                <td style="font-weight: 700;">TOTAL FEE (EXCLUDING GST & TDS):</td>
                <td class="right-align" style="font-weight: 700;">${formatCurrency(totalFee)}</td>
            </tr>
            <tr><td colspan="2" style="padding-top: 10px; border-top: 1px solid #ddd;"></td></tr>
        `;

        // --- 2. TDS DEDUCTIONS (Split-up) ---
        sectionHTML += `<tr><td colspan="2" style="font-weight: 700; background-color: #f0f0f0; padding-top: 8px; padding-bottom: 8px;">TDS DEDUCTIONS:</td></tr>`;
        tdsFields.forEach(field => {
            const value = parseNumber(record[field]);
            totalTDS += value;

            sectionHTML += `
                <tr class="deduction">
                    <td>(-) Less ${field}</td>
                    <td class="right-align">${formatCurrency(value)}</td>
                </tr>
            `;
        });
        
        // --- 3. NET TOTAL ---
        const totalNet = totalFee - totalTDS;

        sectionHTML += `
            <tr class="section-net-total">
                <td style="font-weight: 900;">TOTAL FEE NET (Fees - TDS)</td>
                <td class="right-align" style="font-weight: 900;">${formatCurrency(totalNet)}</td>
            </tr>
            <tr><td colspan="2" style="padding-top: 10px; border-top: 1px solid #ddd;"></td></tr>
        `;

        // --- 4. GST (Listed separately for non-confusion) ---
        sectionHTML += `<tr><td colspan="2" style="font-weight: 700; background-color: #f0f0f0; padding-top: 8px; padding-bottom: 8px;">GST COMPONENTS (NOT included in Net Fee):</td></tr>`;
        gstFields.forEach(field => {
            const value = parseNumber(record[field]);
            sectionHTML += `
                <tr class="gst-row">
                    <td>${field}</td>
                    <td class="right-align">${formatCurrency(value)}</td>
                </tr>
            `;
        });
        
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

// Function to format and render the snapshot box
function renderSnapshot(record) {
    SNAPSHOT_BOX.innerHTML = '';

    const getFormattedCurrency = (sheetHeader) => {
        let value = record[sheetHeader] !== undefined ? record[sheetHeader] : 0;
        const number = parseNumber(value);
        if (isNaN(number)) return 'N/A';
        return number.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
    };

    const rawTotalCharges = calculateTotalCharges(record);
    const formattedTotalCharges = rawTotalCharges.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

    const snapshotItems = [
        { header: "Loan Amount", label: "Loan Amount", value: getFormattedCurrency("Loan Amount"), class: 'success' },
        { header: "Loan Balance", label: "Loan Balance", value: getFormattedCurrency("Loan Balance"), class: 'primary' },
        { header: "Arrear Amount", label: "Arrear Amount", value: getFormattedCurrency("Arrear Amount"), class: 'danger' },
        { header: "TOTAL CHARGES", label: "TOTAL CHARGES (Net of TDS)", value: formattedTotalCharges, class: 'total-color' },
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
        // All blocks start collapsed by default
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

// ACCORDION LOGIC
function addAccordionListeners() {
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.removeEventListener('click', toggleAccordion);
        header.addEventListener('click', toggleAccordion);
    });
}

function toggleAccordion(event) {
    const header = event.currentTarget;
    const contentWrapper = header.nextElementSibling;
    
    header.classList.toggle('expanded');
    contentWrapper.classList.toggle('expanded');

    // Update the icon
    const icon = header.querySelector('.accordion-icon');
    if (header.classList.contains('expanded')) {
        icon.textContent = '▼';
    } else {
        icon.textContent = '▶';
    }
}

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
dataToSend["ADVOCATE"] = ADVOCATE_TRACKER_SELECT.value; // CRITICAL ADDITION: Advocate's Name for unique row targeting
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