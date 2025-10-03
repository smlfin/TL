// Helper function to format date strings from Google Sheets to dd/mm/yyyy// Helper function to format date strings from Google Sheets to dd/mm/yyyy
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

// CHARGE FIELDS for Summation
const CHARGE_FIELDS = [
    "Demand Notice Expense",
    "Sec 09 Expense",
    "Sec.138 Expense"
];


// Helper function to safely parse and sum charge fields
function calculateTotalCharges(record) {
    let total = 0;
    
    const parseNumber = (value) => {
        if (typeof value === 'string') {
            // Remove commas and currency symbols
            value = value.replace(/[$,]/g, '').trim();
        }
        const number = parseFloat(value);
        return isNaN(number) ? 0 : number;
    };

    CHARGE_FIELDS.forEach(field => {
        const value = record[field];
        total += parseNumber(value);
    });

    return total;
}


// API URL now points to the Netlify Function proxy
const API_URL = "/.netlify/functions/fetch-data"; 

const CLIENT_SIDE_AUTH_KEY = "123"; 

// Local storage for all data to enable client-side filtering (cascading dropdowns)
let ALL_RECORDS = []; 


// --- DISPLAY CONFIGURATION ---
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
            "BANK": "Bank",
            "REMARKS": "Remarks",
            "ADVOCATE": "Advocate", 
            "HANDED OVER DATE": "Handed Over Date",
            "Notice Remarks": "Notice Remarks",
            "CASE FILED": "Case Filed",
            "CASE NO": "Case No", 
        }
    },
    {
        title: "4) Section 9",
        fields: {
            // Placeholder: Use whatever clean headers you settled on in the sheet.
            // If you did not rename them, revert to the original names here:
            "Sec/9 Filing Date": "Sec-09 Filing Date",
            "Sec/9 Filing Amt": "Sec-09 Filing Amount",
            "Sec/9 Advocate": "Advocate", 
            "Sec/9 Case No": "Case No",   
            "Attachment eff Date": "Attachment eff Date",
        }
    },
    {
        title: "5) Charges",
        fields: {
            "Demand Notice Expense": "Demand Notice Expense",
            "Sec 09 Expense": "Sec-09 Expense",
            "Sec.138 Exprense": "Sec-138 Expense",
        }
    }
];


// --- DOM ELEMENTS ---
const FORM = document.getElementById('record-form');
const MESSAGE_ELEMENT = document.getElementById('submission-message');
const AUTH_KEY_INPUT = document.getElementById('auth-key');
const AUTH_BUTTON = document.querySelector('button[onclick="showInputForm()"]');
const AUTH_LABEL = document.querySelector('label[for="auth-key"]');

// New Dropdown Elements
const BRANCH_SELECT = document.getElementById('branch-select');
const LOAN_SELECT = document.getElementById('loan-select');
const SEARCH_BUTTON = document.getElementById('search-button');

const LOADING_STATUS = document.getElementById('loading-status');
const DATA_BLOCKS_CONTAINER = document.getElementById('data-blocks');
const DATA_VIEW_SECTION = document.getElementById('data-view-blocks');
const DISPLAY_LOAN_NO = document.getElementById('display-loan-no');
const NOT_FOUND_MESSAGE = document.getElementById('not-found-message');
// NEW SNAPSHOT BOX ELEMENT
const SNAPSHOT_BOX = document.getElementById('loan-snapshot-box');

const HEADER_INPUT = document.getElementById('header_name'); 
const DATA_INPUT = document.getElementById('data_value');


// 1. INITIAL FETCH AND DROPDOWN POPULATION - UNCHANGED
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


// 2. CASCADING LOGIC - UNCHANGED
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
        renderSnapshot(record); // <--- NEW SNAPSHOT CALL
        renderBlocks(record);
        LOADING_STATUS.textContent = `Data loaded for Loan No: ${loanNo}.`;
    } else {
        DATA_BLOCKS_CONTAINER.innerHTML = '';
        SNAPSHOT_BOX.innerHTML = ''; // Clear snapshot on error
        NOT_FOUND_MESSAGE.textContent = `❌ Error: Selected loan not found in data cache.`;
        NOT_FOUND_MESSAGE.style.display = 'block';
        LOADING_STATUS.textContent = 'Search complete.';
    }
}


// NEW: Function to format and render the snapshot box
function renderSnapshot(record) {
    SNAPSHOT_BOX.innerHTML = ''; // Clear previous data

    // Helper to get formatted currency string from a sheet header
    const getFormattedCurrency = (sheetHeader) => {
        let value = record[sheetHeader] !== undefined ? record[sheetHeader] : 0;
        const number = parseFloat(String(value).replace(/[$,]/g, '').trim());
        if (isNaN(number)) return 'N/A';
        return number.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
    };

    // Calculate Total Charges (using the existing helper)
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

// RENDER BLOCKS FUNCTION - UNCHANGED
function renderBlocks(record) {
    DATA_BLOCKS_CONTAINER.innerHTML = '';
    DISPLAY_LOAN_NO.textContent = record["Loan No"] || 'N/A';
    
<<<<<<< HEAD
    // Create the main content grid wrapper for blocks 2-5
    const detailGridWrapper = document.createElement('div');
    detailGridWrapper.id = 'detail-content-grid'; // New ID for CSS grid layout

=======
>>>>>>> 4180f5a04934db17c79f4ab197b569f858dff9d7
    DISPLAY_BLOCKS.forEach((blockConfig, index) => {
        const block = document.createElement('div');
        block.className = 'data-block';

        if (index === 0) {
            // Block 1: Always full width, handles its own horizontal grid
            block.classList.add('horizontal-grid');
<<<<<<< HEAD
            DATA_BLOCKS_CONTAINER.appendChild(block); // Append Block 1 directly to the main container
        } else {
            // Blocks 2 through 5 will go into the new detailGridWrapper
            // The position in the grid will be handled by CSS based on the block ID/class
            block.classList.add(`block-${index + 1}`); 

            if (index === 1) {
                block.classList.add('legal-remarks');
=======
        } else if (index === 1) {
            block.classList.add('legal-remarks');
        }
        
        const title = document.createElement('h3');
        title.textContent = blockConfig.title;
        block.appendChild(title);
        
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'data-block-content';
        
        Object.entries(blockConfig.fields).forEach(([sheetHeader, displayName]) => {
            let value = record[sheetHeader] !== undefined ? record[sheetHeader] : 'N/A';
            
            // Apply date formatting
            if (DATE_FIELDS.includes(sheetHeader) && value !== 'N/A') {
                value = formatDate(value);
>>>>>>> 4180f5a04934db17c79f4ab197b569f858dff9d7
            }
            
            // ... (The rest of the rendering logic for the block content is unchanged)
            
            const title = document.createElement('h3');
            title.textContent = blockConfig.title;
            block.appendChild(title);
            
            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'data-block-content';
            
<<<<<<< HEAD
            Object.entries(blockConfig.fields).forEach(([sheetHeader, displayName]) => {
                let value = record[sheetHeader] !== undefined ? record[sheetHeader] : 'N/A';
                
                // Apply date formatting
                if (DATE_FIELDS.includes(sheetHeader) && value !== 'N/A') {
                    value = formatDate(value);
                }
                
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

            // Calculate and append Total Charges for Block 5
            if (index === 4) { // Block 5: Charges
                const total = calculateTotalCharges(record);
                const totalItem = document.createElement('div');
                totalItem.className = 'data-block-item total-charges'; 

                const label = document.createElement('span');
                label.className = 'item-label';
                label.textContent = `TOTAL CHARGES:`;

                const dataValue = document.createElement('span');
                dataValue.className = 'item-value critical-value'; 
                
                // Format to currency with two decimal places
                dataValue.textContent = total.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

                totalItem.appendChild(label);
                totalItem.appendChild(dataValue);
                contentWrapper.appendChild(totalItem);
            }

            block.appendChild(contentWrapper);
            detailGridWrapper.appendChild(block); // Append blocks 2-5 to the wrapper
        }
=======
            // Apply CRITICAL HIGHLIGHT
            if (CRITICAL_FIELDS.includes(sheetHeader)) {
                dataValue.classList.add('critical-value');
            }
            
            item.appendChild(label);
            item.appendChild(dataValue);
            contentWrapper.appendChild(item);
        });

        // Calculate and append Total Charges for Block 5
        if (index === 4) { // Block 5: Charges
            const total = calculateTotalCharges(record);
            const totalItem = document.createElement('div');
            totalItem.className = 'data-block-item total-charges'; 

            const label = document.createElement('span');
            label.className = 'item-label';
            label.textContent = `TOTAL CHARGES:`;

            const dataValue = document.createElement('span');
            dataValue.className = 'item-value critical-value'; 
            
            // Format to currency with two decimal places
            dataValue.textContent = total.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

            totalItem.appendChild(label);
            totalItem.appendChild(dataValue);
            contentWrapper.appendChild(totalItem);
        }

        block.appendChild(contentWrapper);
        DATA_BLOCKS_CONTAINER.appendChild(block);
>>>>>>> 4180f5a04934db17c79f4ab197b569f858dff9d7
    });

    // Append the new wrapper containing blocks 2-5 after Block 1 is done
    DATA_BLOCKS_CONTAINER.appendChild(detailGridWrapper);
}


// 4. UI Toggling - UNCHANGED
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


// 5. WRITE OPERATION - UNCHANGED
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
