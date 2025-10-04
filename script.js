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

// --- UPDATED CHARGE FIELDS for Summation (Used for the Snapshot Box Total and currency formatting) ---
const CHARGE_FIELDS = [
    "Demand Notice Expense", // Retain this original field
    
    // Section 138 Fee & Charges
    "Cheque Return Charges",
    "POA for Filing Sec 138",
    "Initial Fee for Sec.138",
    "GST of Sec.138 Initial Fee",
    "TDS of Sec.138 Initial Fee",
    "Sec.138 Notice Expense",
    "Warrant Steps of Sec 138",
    "Final fee for Sec 138",
    "GST of Final fee for Sec 138",
    "TDS of Final fee for Sec 138",

    // Section 09 Fee & Charges
    "Schedule Taken Expense for Sec 09 filing",
    "POA for Filing Sec 09",
    "Initial Fee for Sec 09",
    "GST of Sec 09 Initial Fee",
    "TDS of Initial Fee",
    "Fresh Notice Expense for Filing Sec 09",
    "Attachment Batta For Sec 09",
    "Attachment Petition",
    "Property Attachment Expense",
    "Sec 09 Court fee & E-Filing Expense",
    "Final Fee For Sec 09",
    "GST of Final Fee For Sec 09",
    "TDS of Final Fee For Sec 09",
    "Attachment Lifting Expense"
];

// --- NEW CONSTANTS FOR SUBTOTALLING ---

const SECTION_138_CHARGE_FIELDS = [
    "Cheque Return Charges",
    "POA for Filing Sec 138",
    "Initial Fee for Sec.138",
    "GST of Sec.138 Initial Fee",
    "Sec.138 Notice Expense",
    "Warrant Steps of Sec 138",
    "Final fee for Sec 138",
    "GST of Final fee for Sec 138",
];
const SECTION_138_TDS_FIELDS = [
    "TDS of Sec.138 Initial Fee",
    "TDS of Final fee for Sec 138"
];
const SECTION_138_ADVOCATE_FIELDS = [
    "Initial Fee for Sec.138",
    "GST of Sec.138 Initial Fee",
    "Final fee for Sec 138",
    "GST of Final fee for Sec 138",
];


const SECTION_09_CHARGE_FIELDS = [
    "Schedule Taken Expense for Sec 09 filing",
    "POA for Filing Sec 09",
    "Initial Fee for Sec 09",
    "GST of Sec 09 Initial Fee",
    "Fresh Notice Expense for Filing Sec 09",
    "Attachment Batta For Sec 09",
    "Attachment Petition",
    "Property Attachment Expense",
    "Sec 09 Court fee & E-Filing Expense",
    "Final Fee For Sec 09",
    "GST of Final Fee For Sec 09",
    "Attachment Lifting Expense"
];
const SECTION_09_TDS_FIELDS = [
    "TDS of Initial Fee",
    "TDS of Final Fee For Sec 09"
];
const SECTION_09_ADVOCATE_FIELDS = [
    "Initial Fee for Sec 09",
    "GST of Sec 09 Initial Fee",
    "Final Fee For Sec 09",
    "GST of Final Fee For Sec 09",
];


// Helper function to safely parse a number from a string
const parseNumber = (value) => {
    if (typeof value === 'string') {
        value = value.replace(/[$,₹]/g, '').trim();
    }
    const number = parseFloat(value);
    return isNaN(number) ? 0 : number;
};

// Helper function to safely parse and sum charge fields
function calculateTotalCharges(record) {
    let total = 0;
    CHARGE_FIELDS.forEach(field => {
        total += parseNumber(record[field]);
    });
    return total;
}

// NEW: Helper function to calculate Subtotal for a section (Charges - TDS)
function calculateSectionSubtotals(record, chargeFields, tdsFields) {
    let totalCharges = 0;
    chargeFields.forEach(field => {
        totalCharges += parseNumber(record[field]);
    });

    let totalTDS = 0;
    tdsFields.forEach(field => {
        totalTDS += parseNumber(record[field]);
    });

    return { totalCharges, totalTDS, subtotal: totalCharges - totalTDS };
}

// NEW: Helper function to calculate Advocate Fees (Initial + Final + GST - TDS)
function calculateAdvocateFees(record, advocateFields, tdsFields) {
    let totalAdvocateFees = 0;
    advocateFields.forEach(field => {
        totalAdvocateFees += parseNumber(record[field]);
    });

    let totalTDS = 0;
    tdsFields.forEach(field => {
        totalTDS += parseNumber(record[field]);
    });

    return { totalFees: totalAdvocateFees, subtotal: totalAdvocateFees - totalTDS };
}
// --- END NEW HELPERS ---


// API URL now points to the Netlify Function proxy
const API_URL = "/.netlify/functions/fetch-data"; 

const CLIENT_SIDE_AUTH_KEY = "123"; 

// Local storage for all data to enable client-side filtering (cascading dropdowns)
let ALL_RECORDS = []; 


// --- UPDATED DISPLAY CONFIGURATION ---
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
    // --- NEW BLOCK 5 (Index 4) ---
    {
        title: "5) Section 138 Fee & Charges",
        fields: {
            "Cheque Return Charges": "Cheque Return Charges",
            "POA for Filing Sec 138": "POA for Filing",
            "Initial Fee for Sec.138": "Initial Fee",
            "GST of Sec.138 Initial Fee": "GST of Initial Fee",
            "TDS of Sec.138 Initial Fee": "TDS of Initial Fee",
            "Sec.138 Notice Expense": "Notice Expense",
            "Warrant Steps of Sec 138": "Warrant Steps",
            "Final fee for Sec 138": "Final fee",
            "GST of Final fee for Sec 138": "GST of Final fee",
            "TDS of Final fee for Sec 138": "TDS of Final fee",
        }
    },
    // --- NEW BLOCK 6 (Index 5) ---
    {
        title: "6) Section 09 Fee & Charges",
        fields: {
            "Schedule Taken Expense for Sec 09 filing": "Schedule Taken Expense",
            "POA for Filing Sec 09": "POA for Filing",
            "Initial Fee for Sec 09": "Initial Fee",
            "GST of Sec 09 Initial Fee": "GST of Initial Fee",
            "TDS of Initial Fee": "TDS of Initial Fee",
            "Fresh Notice Expense for Filing Sec 09": "Fresh Notice Expense",
            "Attachment Batta For Sec 09": "Attachment Batta",
            "Attachment Petition": "Attachment Petition",
            "Property Attachment Expense": "Property Attachment Expense",
            "Sec 09 Court fee & E-Filing Expense": "Court fee & E-Filing Expense",
            "Final Fee For Sec 09": "Final Fee",
            "GST of Final Fee For Sec 09": "GST of Final Fee",
            "TDS of Final Fee For Sec 09": "TDS of Final Fee",
            "Attachment Lifting Expense": "Attachment Lifting Expense",
        }
    }
];


// --- DOM ELEMENTS (UPDATED) ---
const FORM = document.getElementById('record-form');
const MESSAGE_ELEMENT = document.getElementById('submission-message');
const AUTH_KEY_INPUT = document.getElementById('auth-key');
const AUTH_BUTTON = document.getElementById('enable-input-button'); 
const AUTH_LABEL = document.querySelector('label[for="auth-key"]');

// Dropdown Elements
const BRANCH_SELECT = document.getElementById('branch-select');
const LOAN_SELECT = document.getElementById('loan-select');
const SEARCH_BUTTON = document.getElementById('search-button');

const LOADING_STATUS = document.getElementById('loading-status');
const DATA_BLOCKS_CONTAINER = document.getElementById('data-blocks');
const DATA_VIEW_SECTION = document.getElementById('data-view-blocks');
const DISPLAY_LOAN_NO = document.getElementById('display-loan-no');
const NOT_FOUND_MESSAGE = document.getElementById('not-found-message');
// SNAPSHOT BOX ELEMENT
const SNAPSHOT_BOX = document.getElementById('loan-snapshot-box');

const HEADER_INPUT = document.getElementById('header_name'); 
const DATA_INPUT = document.getElementById('data_value');

// NEW: Toggle Switch for Advocate Fees
const ADVOCATE_FEE_TOGGLE = document.getElementById('advocate-fee-toggle');


// 1. INITIAL FETCH AND DROPDOWN POPULATION (Unchanged)
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
            LOADING_STATUS.textContent = 'Ready. Select Branch & Loan No.';
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


// 2. CASCADING LOGIC (Unchanged)
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


// 3. DISPLAY LOGIC (Search Button Click) (UPDATED: Added Toggle Listener)
SEARCH_BUTTON.addEventListener('click', displayLoan);
ADVOCATE_FEE_TOGGLE.addEventListener('change', displayLoan); // Re-render blocks when toggle changes


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
    ADVOCATE_FEE_TOGGLE.parentNode.style.display = 'flex'; // Show toggle

    if (record) {
        renderSnapshot(record); 
        renderBlocks(record);
        LOADING_STATUS.textContent = `Data loaded for Loan No: ${loanNo}.`;
    } else {
        DATA_BLOCKS_CONTAINER.innerHTML = '';
        SNAPSHOT_BOX.innerHTML = ''; // Clear snapshot on error
        NOT_FOUND_MESSAGE.textContent = `❌ Error: Selected loan not found in data cache.`;
        NOT_FOUND_MESSAGE.style.display = 'block';
        LOADING_STATUS.textContent = 'Search complete.';
        ADVOCATE_FEE_TOGGLE.parentNode.style.display = 'none'; // Hide toggle on error
    }
}


// Function to format and render the snapshot box (Unchanged)
function renderSnapshot(record) {
    SNAPSHOT_BOX.innerHTML = ''; // Clear previous data

    // Helper to get formatted currency string from a sheet header
    const getFormattedCurrency = (sheetHeader) => {
        let value = record[sheetHeader] !== undefined ? record[sheetHeader] : 0;
        const number = parseNumber(value); // Using the general parseNumber
        if (isNaN(number)) return 'N/A';
        return number.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
    };

    // Calculate Total Charges (using the updated helper)
    const rawTotalCharges = calculateTotalCharges(record);
    const formattedTotalCharges = rawTotalCharges.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

    const snapshotItems = [
        { header: "Loan Amount", label: "Loan Amount", value: getFormattedCurrency("Loan Amount"), class: 'success' },
        { header: "Loan Balance", label: "Loan Balance", value: getFormattedCurrency("Loan Balance"), class: 'primary' },
        { header: "Arrear Amount", label: "Arrear Amount", value: getFormattedCurrency("Arrear Amount"), class: 'danger' },
        { header: "TOTAL CHARGES", label: "TOTAL CHARGES", value: formattedTotalCharges, class: 'total-color' },
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


// RENDER BLOCKS FUNCTION - **MODIFIED LOGIC**
function renderBlocks(record) {
    DATA_BLOCKS_CONTAINER.innerHTML = '';
    DISPLAY_LOAN_NO.textContent = record["Loan No"] || 'N/A';
    
    const showAdvocateOnly = ADVOCATE_FEE_TOGGLE.checked;
    
    // 1. Create all block elements and store them
    const blockElements = {};
    
    DISPLAY_BLOCKS.forEach((blockConfig, index) => {
        const block = document.createElement('div');
        const blockNumber = index + 1;
        block.classList.add('data-block', `block-${blockNumber}`);

        // Set class for horizontal grid (1, 3, 5, 6) or specific classes (2)
        if (blockNumber === 1 || blockNumber === 3 || blockNumber === 5 || blockNumber === 6) { 
            block.classList.add('horizontal-grid');
        } else if (blockNumber === 2) { 
             block.classList.add('legal-remarks');
        }
        
        const title = document.createElement('h3');
        title.textContent = blockConfig.title;
        block.appendChild(title);
        
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'data-block-content';

        let sectionChargeFields = [];
        let sectionTDSFields = [];
        let sectionAdvocateFields = [];

        // Determine fields based on block number for fees blocks
        if (blockNumber === 5) { // Section 138
            sectionChargeFields = SECTION_138_CHARGE_FIELDS;
            sectionTDSFields = SECTION_138_TDS_FIELDS;
            sectionAdvocateFields = SECTION_138_ADVOCATE_FIELDS;
        } else if (blockNumber === 6) { // Section 09
            sectionChargeFields = SECTION_09_CHARGE_FIELDS;
            sectionTDSFields = SECTION_09_TDS_FIELDS;
            sectionAdvocateFields = SECTION_09_ADVOCATE_FIELDS;
        }

        // Add regular fields
        Object.entries(blockConfig.fields).forEach(([sheetHeader, displayName]) => {
            
            // NEW: Skip fields if the toggle is ON AND the field is NOT part of the advocate's calculation
            if (showAdvocateOnly && (blockNumber === 5 || blockNumber === 6)) {
                const isAdvocateField = sectionAdvocateFields.includes(sheetHeader) || sectionTDSFields.includes(sheetHeader);
                if (!isAdvocateField) {
                    return; // Skip non-advocate fields
                }
            }

            let value = record[sheetHeader] !== undefined ? record[sheetHeader] : 'N/A';
            
            // Apply date formatting
            if (DATE_FIELDS.includes(sheetHeader) && value !== 'N/A') {
                value = formatDate(value);
            }

            // --- CURRENCY FORMATTING LOGIC FOR CHARGE FIELDS ---
            if (CHARGE_FIELDS.includes(sheetHeader) && value !== 'N/A') {
                
                const number = parseNumber(value);
                // If it's a valid number, format it as currency, otherwise return the original string
                if (!isNaN(number)) {
                     value = number.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
                }
            }
            // --- END CURRENCY FORMATTING LOGIC ---
            
            const item = document.createElement('div');
            item.className = 'data-block-item';
            
            const label = document.createElement('span');
            label.className = 'item-label';
            label.textContent = `${displayName}:`;
            
            const dataValue = document.createElement('span');
            dataValue.className = 'item-value';
            dataValue.textContent = value;
            
            // Apply CRITICAL HIGHLIGHT
            if (CRITICAL_FIELDS.includes(sheetHeader)) {
                dataValue.classList.add('critical-value');
            }
            
            item.appendChild(label);
            item.appendChild(dataValue);
            contentWrapper.appendChild(item);
        });

        // NEW: Add subtotals for Blocks 5 and 6
        if (blockNumber === 5 || blockNumber === 6) {
            
            // --- 1. Advocate Fee Subtotal Row ---
            const advocateFees = calculateAdvocateFees(record, sectionAdvocateFields, sectionTDSFields);
            const formattedAdvocateSubtotal = advocateFees.subtotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
            
            const advSubtotalItem = document.createElement('div');
            advSubtotalItem.className = 'data-block-item subtotal-row advocate-subtotal';
            advSubtotalItem.innerHTML = `
                <span class="item-label">ADVOCATE FEE NET (Initial + Final + GST - TDS):</span>
                <span class="item-value critical-value">${formattedAdvocateSubtotal}</span>
            `;
            contentWrapper.appendChild(advSubtotalItem);
            
            // --- 2. Full Section Subtotal Row ---
            const totals = calculateSectionSubtotals(record, sectionChargeFields, sectionTDSFields);
            const formattedSubtotal = totals.subtotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

            // Only show this subtotal if the advocate-only toggle is OFF
            if (!showAdvocateOnly) {
                const subtotalItem = document.createElement('div');
                subtotalItem.className = 'data-block-item subtotal-row section-subtotal';
                subtotalItem.innerHTML = `
                    <span class="item-label">SECTION SUBTOTAL (All Charges - All TDS):</span>
                    <span class="item-value critical-value">${formattedSubtotal}</span>
                `;
                contentWrapper.appendChild(subtotalItem);
            }
        }

        block.appendChild(contentWrapper);
        blockElements[blockNumber] = block;
    });

    // 2. Assemble the DOM structure in the correct order: B1, Grid (B2, B4), B3, B5, B6
    
    // Create the two-column wrapper for blocks 2 and 4
    const detailGridWrapper = document.createElement('div');
    detailGridWrapper.id = 'detail-content-grid';
    
    // Append Block 2 and Block 4 into the detail grid
    if (blockElements[2]) detailGridWrapper.appendChild(blockElements[2]);
    if (blockElements[4]) detailGridWrapper.appendChild(blockElements[4]);
    
    // Clear and Append to the main container in the desired sequence
    DATA_BLOCKS_CONTAINER.innerHTML = '';
    
    // B1 (Full Width/Horizontal Grid)
    if (blockElements[1]) DATA_BLOCKS_CONTAINER.appendChild(blockElements[1]);
    
    // Detail Grid (B2 & B4)
    if (detailGridWrapper.children.length > 0) {
        DATA_BLOCKS_CONTAINER.appendChild(detailGridWrapper);
    }
    
    // B3 (Full Width/Horizontal Grid)
    if (blockElements[3]) DATA_BLOCKS_CONTAINER.appendChild(blockElements[3]);
    
    // B5 (Full Width/Horizontal Grid)
    if (blockElements[5]) DATA_BLOCKS_CONTAINER.appendChild(blockElements[5]);
    
    // B6 (Full Width/Horizontal Grid)
    if (blockElements[6]) DATA_BLOCKS_CONTAINER.appendChild(blockElements[6]);
}


// 4. UI Toggling (Unchanged)
function showInputForm() {
    const enteredKey = AUTH_KEY_INPUT.value;
    
    if (enteredKey === CLIENT_SIDE_AUTH_KEY) {
        FORM.style.display = 'grid'; 
        AUTH_KEY_INPUT.style.display = 'none';
        document.getElementById('enable-input-button').style.display = 'none';
        AUTH_LABEL.textContent = 'Write Access Granted.';
        alert('Write access enabled! Please fill out the form.');
    } else {
        alert('Authorization failed. Please enter the correct secret key.');
        AUTH_KEY_INPUT.value = '';
    }
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

    const dataToSend = {};
    dataToSend[headerName] = dataValue; 
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
        MESSAGE_ELEMENT.textContent = '❌ Network Error. Could not connect to API.';
        console.error("Submission error:", error);
    }
});