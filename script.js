// Helper function to format date strings from Google Sheets to dd/mm/yyyy
function formatDate(dateValue) {
    if (!dateValue || dateValue === 'N/A' || String(dateValue).startsWith('18')) {
        return dateValue;
    }
    
    let date;

    // 1. Try to parse as a standard JavaScript date (handles ISO format/serial numbers)
    date = new Date(dateValue);
    
    // 2. If standard parsing fails (i.e., it's a raw string like '28.08.2025' or '28/08/2025')
    if (isNaN(date.getTime())) {
        try {
            // Normalize separators to handle both '.' and '/' for manual parsing
            const parts = String(dateValue).trim().split(/[\.\/]/); 
            
            // Check for dd/mm/yyyy format (3 parts)
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


// Helper function to safely parse a value
const parseNumber = (value) => {
    if (typeof value === 'string') {
        value = value.replace(/[$,]/g, '').trim();
    }
    const number = parseFloat(value);
    return isNaN(number) ? 0 : number;
};

// Function to calculate net total for any group of charges 
// (Used for Other Charges and Snapshot Total - adds all non-TDS fields, subtracts TDS)
function calculateChargesNet(record, fields) {
    let total = 0;
    
    fields.forEach(field => {
        let sign = 1; 

        // Check for TDS (Tax Deducted at Source) fields which should be subtracted
        if (field.includes("TDS")) {
            sign = -1;
        }
        
        const value = record[field];
        // Use parseNumber here, which is critical for robustness against non-numeric inputs
        total += parseNumber(value) * sign;
    });

    return total;
}

// NEW Function to calculate the required Advocate Fee Payment Net 
// (Fee - TDS, EXCLUDING GST - used for Advocate Fee Net and Tracker)
function calculateAdvocateFeePaymentNet(record, feeNetFields) {
    let total = 0;
    
    // feeNetFields is explicitly defined to contain only Fee and TDS fields.
    feeNetFields.forEach(field => {
        let sign = 1; 

        // Check for TDS fields which should be subtracted
        if (field.includes("TDS")) {
            sign = -1;
        }
        
        const value = record[field];
        total += parseNumber(value) * sign;
    });

    return total;
}

// --- CHARGE FIELD DEFINITIONS FOR BLOCKS 5 & 6 ---

// 5) Section 138 Fee & Charges Definitions
const CHARGE_DEFINITIONS_138 = {
    // For calculating the Net Payment (Fee - TDS, excluding GST)
    "AdvocateFeeNetFields": [
        "Initial Fee for Sec.138", // Fee
        "TDS of Sec.138 Initial Fee", // TDS (subtracted)
        "Final fee for Sec 138", // Fee
        "TDS of Final fee for Sec 138", // TDS (subtracted)
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
    // For calculating the Net Payment (Fee - TDS, excluding GST)
    "AdvocateFeeNetFields": [
        "Initial Fee for Sec 09", // Fee
        "TDS of Initial Fee", // TDS (subtracted)
        "Final Fee For Sec 09", // Fee
        "TDS of Final Fee For Sec 09", // TDS (subtracted)
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

// All Charge Fields for Snapshot Box Total (Must include Demand Notice Expense)
const CHARGE_FIELDS_FOR_SNAPSHOT = [
    "Demand Notice Expense",
    ...CHARGE_DEFINITIONS_138.AdvocateFeeFieldsDisplay,
    ...CHARGE_DEFINITIONS_138.OtherChargesFields,
    ...CHARGE_DEFINITIONS_09.AdvocateFeeFieldsDisplay,
    ...CHARGE_DEFINITIONS_09.OtherChargesFields,
];

// Helper function to calculate the total for the Snapshot Box
function calculateTotalCharges(record) {
    // Snapshot Total is a sum of ALL charges (positive and negative, like TDS)
    return calculateChargesNet(record, CHARGE_FIELDS_FOR_SNAPSHOT.map(f => f));
}


// API URL now points to the Netlify Function proxy
const API_URL = "/.netlify/functions/fetch-data"; 
const CLIENT_SIDE_AUTH_KEY = "123"; 

let ALL_RECORDS = []; 
window.CURRENT_LOAN_RECORD = null;

// NEW DEFINITIONS FOR ADVOCATE TRACKER STATUS
const STATUS_FIELD = "Advocate Payment Status"; // Assuming this is the column name in the sheet
const STATUS_OPTIONS = ["Processing", "Rejected", "Paid"]; // Changed order to match user request

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
    // --- BLOCK 5: Section 138 Fee & Charges (All Fields) ---
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
    // --- BLOCK 6: Section 09 Fee & Charges (All Fields) ---
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


// --- DOM ELEMENTS ---
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
const DISPLAY_LOAN_NO = document.getElementById('display-loan-no');
const NOT_FOUND_MESSAGE = document.getElementById('not-found-message');
const SNAPSHOT_BOX = document.getElementById('loan-snapshot-box');
const HEADER_INPUT = document.getElementById('header_name'); 
const DATA_INPUT = document.getElementById('data_value');
const ADVOCATE_FEE_CONTROLS = document.getElementById('advocate-fee-controls');
const ADVOCATE_FEE_TOGGLE = document.getElementById('advocate-fee-toggle');

// ELEMENTS FOR ADVOCATE TRACKER
const ADVOCATE_TRACKER_SELECT = document.getElementById('advocate-tracker-select');
const ADVOCATE_PAYMENTS_VIEW = document.getElementById('advocate-payments-view');


// 1. INITIAL FETCH AND DROPDOWN POPULATION (Modified to include advocate list population)
document.addEventListener('DOMContentLoaded', initialLoad);

async function initialLoad() {
    LOADING_STATUS.textContent = 'Fetching all data to populate dropdowns...';
    try {
        const response = await fetch(API_URL, {
            method: 'GET',
            mode: 'cors' 
        });

        const result = await response.json();

        if (result.status === 'success' && result.data && result.data.length > 0) {
            ALL_RECORDS = result.data;
            populateBranchDropdown(ALL_RECORDS);
            populateAdvocateDropdown(ALL_RECORDS); // NEW: Populate advocate list
            
            // Check if an advocate was previously selected before reload
            const lastSelectedAdvocate = ADVOCATE_TRACKER_SELECT.value;
            if (lastSelectedAdvocate) {
                 displayAdvocateSummary(lastSelectedAdvocate); // Re-render if advocate was selected
            } else {
                 LOADING_STATUS.textContent = 'Ready. Select Branch & Loan No. to view file details, or use the Advocate Tracker.';
            }

        } else {
            LOADING_STATUS.textContent = '❌ Error: Could not load data from the server.';
            BRANCH_SELECT.innerHTML = '<option value="">-- Data Load Failed --</option>';
        }

    } catch (error) {
        console.error("Error fetching data:", error);
        LOADING_STATUS.textContent = '❌ Network Error. Could not connect to API.';
    }
}

function populateBranchDropdown(records) {
    const branches = new Set();
    records.forEach(record => {
        const branchName = record["Loan Branch"];
        if (branchName && String(branchName).trim() !== '') {
            branches.add(String(branchName).trim());
        }
    });

    BRANCH_SELECT.innerHTML = '<option value="" selected disabled>-- Select Branch --</option>';
    
    [...branches].sort().forEach(branch => {
        const option = document.createElement('option');
        option.value = branch;
        option.textContent = branch;
        BRANCH_SELECT.appendChild(option);
    });

    BRANCH_SELECT.disabled = false;
}

// Populate Advocate Dropdown
function populateAdvocateDropdown(records) {
    const advocates = new Set();
    // Keep the previously selected advocate if available
    const currentlySelected = ADVOCATE_TRACKER_SELECT.value;

    records.forEach(record => {
        const adv138 = String(record["ADVOCATE"]).trim();
        const adv09 = String(record["Sec/9 Advocate"]).trim();
        
        // Collect from ADVOCATE (Sec 138)
        if (adv138 && adv138 !== 'N/A' && adv138 !== '') {
            advocates.add(adv138);
        }
        // Collect from Sec/9 Advocate (Sec 09)
        if (adv09 && adv09 !== 'N/A' && adv09 !== '') {
            advocates.add(adv09);
        }
    });

    ADVOCATE_TRACKER_SELECT.innerHTML = '<option value="" disabled>-- Select Advocate --</option>';
    
    [...advocates].sort().forEach(advocate => {
        const option = document.createElement('option');
        option.value = advocate;
        option.textContent = advocate;
        if (advocate === currentlySelected) {
            option.selected = true;
        }
        ADVOCATE_TRACKER_SELECT.appendChild(option);
    });
    
    // Only select the default placeholder if nothing was previously selected
    if (!currentlySelected) {
        ADVOCATE_TRACKER_SELECT.querySelector('option[disabled]').selected = true;
    }

    ADVOCATE_TRACKER_SELECT.disabled = false;
}

// Helper function to format currency for the table
function formatCurrency(value) {
    const number = parseNumber(value);
    if (isNaN(number)) return 'N/A';
    // Use 'en-IN' locale for Indian Rupees format
    return number.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
}


// --- ADVOCATE TRACKER STATUS LOGIC ---

// Helper function to render the status tag (the initial, disabled state)
function renderStatusTag(statusValue, loanNo) {
    // Default to 'Processing' if status is empty/null
    const status = statusValue || 'Processing';
    
    // Convert status to a CSS class name
    const statusClass = status.replace(/ /g, '-').toLowerCase();

    // The tag is the UNEDITABLE state. It is always clickable to start the process.
    return `
        <span 
            class="status-tag status-${statusClass}"
            data-loan-no="${loanNo}" 
            data-current-status="${status}" 
            onclick="handleStatusClick(this)"
            title="Click to edit status (password required)"
        >
            ${status} <span class="edit-icon">🔒</span>
        </span>
    `;
}

// 4.1. Handle the initial click (The password step)
function handleStatusClick(element) {
    const loanNo = element.dataset.loanNo;
    const currentStatus = element.dataset.currentStatus;
    const tdElement = element.parentNode; // The TD element containing the status

    // 1. Ask for password
    const password = prompt("Enter password to change status:");

    if (password === CLIENT_SIDE_AUTH_KEY) { // CLIENT_SIDE_AUTH_KEY is "123"
        // 2. Password accepted, enable edit
        enableStatusEdit(tdElement, loanNo, currentStatus);
    } else if (password !== null && password !== '') { 
        alert("Incorrect password. Status update aborted.");
    }
}

// 4.2. Replace tag with dropdown and buttons
function enableStatusEdit(tdElement, loanNo, currentStatus) {
    let selectHTML = `<div class="status-edit-mode">`;
    
    // Dropdown for status selection
    selectHTML += `<select id="status-select-${loanNo}" class="status-select" data-loan-no="${loanNo}">`;
    
    STATUS_OPTIONS.forEach(option => {
        // Ensure the currently saved status is the default selected value
        const isSelected = option === currentStatus ? 'selected' : '';
        selectHTML += `<option value="${option}" ${isSelected}>${option}</option>`;
    });

    selectHTML += `</select>`;
    
    // Add Save and Cancel buttons, passing necessary data
    selectHTML += `
        <div class="status-buttons">
            <button class="status-save-btn" onclick="confirmSaveStatus('${loanNo}', '${currentStatus}')">Save</button>
            <button class="status-cancel-btn" onclick="cancelStatusEdit(document.getElementById('status-cell-${loanNo}'), '${currentStatus}', '${loanNo}')">Cancel</button>
        </div>
    </div>`;
    
    // Replace the content of the <td> with the edit interface
    tdElement.innerHTML = selectHTML;
}

// 4.3. Function to revert to the disabled state without saving
function cancelStatusEdit(tdElement, originalStatus, loanNo) {
    // Revert the TD's content back to the original disabled tag
    tdElement.innerHTML = renderStatusTag(originalStatus, loanNo);
}

// 4.4. Save new status and trigger full reload/re-render
async function confirmSaveStatus(loanNo, originalStatus) {
    const selectElement = document.getElementById(`status-select-${loanNo}`);
    const newStatus = selectElement.value;
    const tdElement = document.getElementById(`status-cell-${loanNo}`);
    
    if (newStatus === originalStatus) {
        alert("Status is unchanged. Aborting save.");
        cancelStatusEdit(tdElement, originalStatus, loanNo);
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

        const result = await response.json();

        if (result.status === 'success') {
            alert(`✅ Status for Loan No ${loanNo} successfully updated to ${newStatus}.`);
            
            // Reload all data and re-render the summary to update the display
            await initialLoad(); 
            displayAdvocateSummary(ADVOCATE_TRACKER_SELECT.value); 
        } else {
            alert(`❌ Submission Error for Loan ${loanNo}: ${result.message}`);
            // On failure, revert back to the original status tag
            cancelStatusEdit(tdElement, originalStatus, loanNo);
        }

    } catch (error) {
        console.error("Error saving status:", error);
        alert(`❌ Network Error while saving status for Loan ${loanNo}.`);
        // On failure, revert back to the original status tag
        cancelStatusEdit(tdElement, originalStatus, loanNo);
    }
}

// 4. ADVOCATE TRACKER DISPLAY LOGIC
ADVOCATE_TRACKER_SELECT.addEventListener('change', () => displayAdvocateSummary(ADVOCATE_TRACKER_SELECT.value));

function displayAdvocateSummary(selectedAdvocate) {
    
    if (!selectedAdvocate) {
        ADVOCATE_PAYMENTS_VIEW.innerHTML = '<p>Select an Advocate to see their payment summary.</p>';
        return;
    }

    // Filter records: Loan is associated with the selected advocate in either Sec 138 or Sec 09
    const filteredRecords = ALL_RECORDS.filter(record => 
        String(record["ADVOCATE"]).trim() === selectedAdvocate ||
        String(record["Sec/9 Advocate"]).trim() === selectedAdvocate
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
                    <th>Customer Name</th>
                    <th>Section 138 Fee Net</th>
                    <th>Section 09 Fee Net</th>
                    <th>Total Fee Net</th>
                    <th>${STATUS_FIELD}</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    let grandTotalNet = 0;

    filteredRecords.forEach(record => {
        const loanNo = record["Loan No"];
        const custName = record["Customer Name"] || 'N/A';
        const statusValue = record[STATUS_FIELD] || 'Processing'; 
        
        // Calculate Fee Net for Sec 138 and Sec 09
        const feeNet138 = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields);
        const feeNet09 = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
        const totalFeeNet = feeNet138 + feeNet09;
        
        grandTotalNet += totalFeeNet;

        tableHTML += `
            <tr id="row-${loanNo}">
                <td data-label="Loan No">${loanNo}</td>
                <td data-label="Customer Name">${custName}</td>
                <td data-label="Sec 138 Net">${formatCurrency(feeNet138)}</td>
                <td data-label="Sec 09 Net">${formatCurrency(feeNet09)}</td>
                <td data-label="Total Net">${formatCurrency(totalFeeNet)}</td>
                <td data-label="Status" id="status-cell-${loanNo}">
                    ${renderStatusTag(statusValue, loanNo)}
                </td>
            </tr>
        `;
    });

    // Add Grand Total row
    tableHTML += `
            <tr class="grand-total-row">
                <td colspan="4" style="text-align: right; font-weight: 700;">GRAND TOTAL (NET):</td>
                <td style="font-weight: 700; color: var(--color-primary);">${formatCurrency(grandTotalNet)}</td>
                <td></td>
            </tr>
        </tbody>
    </table>
    `;

    ADVOCATE_PAYMENTS_VIEW.innerHTML = tableHTML;
    
    // Reset status message area
    LOADING_STATUS.textContent = `Summary loaded for ${selectedAdvocate}. ${filteredRecords.length} records found.`;
}


// 2. CASCADING LOGIC
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
        .filter(record => String(record["Loan Branch"]).trim() === selectedBranch)
        .map(record => String(record["Loan No"]).trim());

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

// 3. DISPLAY LOGIC (Search Button Click)
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
        String(r["Loan Branch"]).trim() === selectedBranch && 
        String(r["Loan No"]).trim() === loanNo 
    );

    DATA_VIEW_SECTION.style.display = 'block';
    NOT_FOUND_MESSAGE.style.display = 'none';

    if (record) {
        window.CURRENT_LOAN_RECORD = record;
        renderSnapshot(record);
        // Render blocks based on current toggle state
        renderFilteredBlocks(record, ADVOCATE_FEE_TOGGLE.checked);
        
        // Show the toggle container
        ADVOCATE_FEE_CONTROLS.style.display = 'flex';
        
        // Add accordion listeners after blocks are rendered
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

    // Helper to get formatted currency string from a sheet header
    const getFormattedCurrency = (sheetHeader) => {
        let value = record[sheetHeader] !== undefined ? record[sheetHeader] : 0;
        const number = parseNumber(value);
        if (isNaN(number)) return 'N/A';
        return number.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
    };

    // Calculate Total Charges
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
    dataValue.textContent = value;

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

    // Apply date formatting
    if (DATE_FIELDS.includes(sheetHeader)) {
        return formatDate(value);
    }

    // Apply currency formatting for known currency fields (optional but good practice)
    if (sheetHeader.includes("Amount") || sheetHeader.includes("Balance") || sheetHeader.includes("Fee") || sheetHeader.includes("Expense") || sheetHeader.includes("Charges") || sheetHeader.includes("Amt") || sheetHeader.includes("TDS") || sheetHeader.includes("GST")) {
        // Check if value is a known string indicating no value
        if (value === 'N/A' || value === '' || value === 0 || parseNumber(value) === 0) {
             return 'N/A';
        }
        
        const number = parseNumber(value);
        // Highlight TDS amounts as negative visually
        let displayClass = '';
        if (sheetHeader.includes("TDS")) {
            displayClass = 'minus-value';
        }

        // Return a span for coloring, using the shared formatCurrency logic (which handles INR formatting)
        return `<span class="${displayClass}">${formatCurrency(number)}</span>`;
    }
    
    // For general fields, just return the string representation
    return String(value);
}

// Helper to render a group of fields
function renderFieldGroup(record, fields, container) {
    for (const sheetHeader in fields) {
        const displayName = fields[sheetHeader];
        const processedValue = processValue(record, sheetHeader);
        
        // Check if the value is a number wrapped in a span (from processValue) or a raw string
        let valueToRender = processedValue;
        if (typeof processedValue === 'string' && processedValue.startsWith('<span')) {
            // It's a colored currency span, insert the HTML directly
            const item = document.createElement('div');
            item.className = 'data-block-item';
            item.innerHTML = `
                <span class="item-label">${displayName}:</span>
                <span class="item-value">${processedValue}</span>
            `;
            container.appendChild(item);
        } else {
            // It's a standard text value, use the helper
            container.appendChild(renderDataItem(sheetHeader, displayName, processedValue));
        }
    }
}

// Function to render the fee/charge subtotals (Blocks 5 and 6)
function renderSubTotals(record, container, definitions, blockTitle) {
    const isSec138 = blockTitle.includes("138");

    // 1. Calculate Advocate Fee Net (Fee - TDS)
    const advocateFeeNet = calculateAdvocateFeePaymentNet(record, definitions.AdvocateFeeNetFields);
    
    // 2. Calculate Other Charges Net (All Other Charges)
    const otherChargesNet = calculateChargesNet(record, definitions.OtherChargesFields);
    
    // 3. Calculate Block Total (Advocate Fee Net + Other Charges Net)
    const blockTotalNet = advocateFeeNet + otherChargesNet;

    // --- Render Advocate Fee Net (Highlighted) ---
    let advocateFeeNetRow = document.createElement('div');
    advocateFeeNetRow.className = 'data-block-item subtotal-row advocate-fee-net';
    advocateFeeNetRow.innerHTML = `
        <span class="item-label">Advocate Fee Net (${isSec138 ? '138' : '09'}):</span>
        <span class="item-value">${formatCurrency(advocateFeeNet)}</span>
    `;
    container.appendChild(advocateFeeNetRow);

    // --- Render Other Charges Net (Highlighted) ---
    let otherChargesNetRow = document.createElement('div');
    otherChargesNetRow.className = 'data-block-item subtotal-row other-charges-net';
    otherChargesNetRow.innerHTML = `
        <span class="item-label">Other Charges Net (${isSec138 ? '138' : '09'}):</span>
        <span class="item-value">${formatCurrency(otherChargesNet)}</span>
    `;
    container.appendChild(otherChargesNetRow);

    // --- Render Block Total (Final) ---
    let blockTotalNetRow = document.createElement('div');
    blockTotalNetRow.className = 'data-block-item subtotal-row block-total-net';
    blockTotalNetRow.innerHTML = `
        <span class="item-label">TOTAL CHARGES THIS SECTION:</span>
        <span class="item-value">${formatCurrency(blockTotalNet)}</span>
    `;
    container.appendChild(blockTotalNetRow);
}


// Main rendering function that respects the toggle
function renderFilteredBlocks(record, showDetailedFees) {
    DATA_BLOCKS_CONTAINER.innerHTML = ''; // Clear previous content

    DISPLAY_BLOCKS.forEach((block, index) => {
        const isFeeBlock = index === 4 || index === 5; // Blocks 5 & 6 (Fee/Charge blocks)
        
        // Skip Fee blocks if toggle is OFF
        if (isFeeBlock && !showDetailedFees) {
            return;
        }

        const blockElement = document.createElement('div');
        blockElement.className = 'data-block';
        
        const isCollapsible = index < 4; // Blocks 1-4 are collapsible

        // Create header
        const header = document.createElement('div');
        header.className = isCollapsible ? 'block-header accordion-header' : 'block-header';
        header.innerHTML = `<h3>${block.title}</h3>${isCollapsible ? '<span class="accordion-icon">▶</span>' : ''}`;

        // Create content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.className = `data-block-content-wrapper${isCollapsible ? ' accordion-content' : ' expanded'}`;
        
        // Create actual content div
        const content = document.createElement('div');
        content.className = 'data-block-content';
        
        // Render standard fields
        renderFieldGroup(record, block.fields, content);

        // If it is a Fee/Charge block (5 or 6), render the subtotals
        if (isFeeBlock) {
            const definitions = isSec138(block.title) ? CHARGE_DEFINITIONS_138 : CHARGE_DEFINITIONS_09;
            renderSubTotals(record, content, definitions, block.title);
        }

        contentWrapper.appendChild(content);
        blockElement.appendChild(header);
        blockElement.appendChild(contentWrapper);
        DATA_BLOCKS_CONTAINER.appendChild(blockElement);
    });
}

// Helper to check if block is Sec 138
function isSec138(title) {
    return title.includes("138");
}


// Toggle functionality for Blocks 5 & 6
ADVOCATE_FEE_TOGGLE.addEventListener('change', () => {
    if (window.CURRENT_LOAN_RECORD) {
        renderFilteredBlocks(window.CURRENT_LOAN_RECORD, ADVOCATE_FEE_TOGGLE.checked);
        addAccordionListeners(); // Re-add listeners after re-render
    }
});


// ACCORDION LOGIC
function addAccordionListeners() {
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.removeEventListener('click', toggleAccordion); // Remove previous listeners
        header.addEventListener('click', toggleAccordion);
    });
}

function toggleAccordion(event) {
    const header = event.currentTarget;
    const contentWrapper = header.nextElementSibling;
    
    header.classList.toggle('expanded');
    contentWrapper.classList.toggle('expanded');
}


// 5. WRITE OPERATION (Unchanged)
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
    
    // Ensure the user is editing the currently selected loan
    if (!LOAN_SELECT.value) {
        MESSAGE_ELEMENT.textContent = '❌ Error: Please select a Loan No. first.';
        return;
    }

    const dataToSend = {};
    dataToSend[headerName] = dataValue; 
    dataToSend["Loan No"] = LOAN_SELECT.value; // Add the key for row identification
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
            initialLoad(); 
        } else {
            MESSAGE_ELEMENT.textContent = `❌ Submission Error: ${result.message}`;
        }

    } catch (error) {
        console.error("Error submitting data:", error);
        MESSAGE_ELEMENT.textContent = '❌ Network Error. Could not submit data.';
    }
});


// 6. TOGGLE WRITE FORM (Unchanged)
function showInputForm() {
    if (AUTH_KEY_INPUT.value === CLIENT_SIDE_AUTH_KEY) {
        FORM.style.display = 'block';
        AUTH_BUTTON.style.display = 'none';
        AUTH_KEY_INPUT.style.display = 'none';
        AUTH_LABEL.style.display = 'none';
        MESSAGE_ELEMENT.textContent = 'Input enabled. Select Loan and enter Column Header & Data.';
    } else {
        alert('Incorrect password. Please enter the correct secret key.');
        AUTH_KEY_INPUT.value = '';
    }
}