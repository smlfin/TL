// ====================================================================
// CONFIGURATION: REPLACE THESE PLACEHOLDERS
// ====================================================================

// API URL now points to the Netlify Function proxy
const API_URL = "/.netlify/functions/fetch-data"; 

// The secret key is now ONLY for the client-side check to enable the form.
const CLIENT_SIDE_AUTH_KEY = "123"; 

// ====================================================================
// FIELD MAPPING CONFIGURATION (FIXED Section 9 HEADERS)
// Note: Header keys must EXACTLY match the Google Sheet Row 1.
// The Section 9 headers are assumed to be renamed in the sheet to handle duplicates.
// ====================================================================
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
            "ADVOCATE": "ADVOCATE", // This references the first "ADVOCATE" column
            "HANDED OVER DATE": "HANDED OVER DATE",
            "Notice Remarks": "Notice Remarks",
            "CASE FILED": "CASE FILED",
            "CASE NO": "CASE NO", // This references the first "CASE NO" column
        }
    },
    {
        title: "4) Section 9",
        fields: {
            "Sec 09 Filing Date": "Sec 09 Filing Date",
            "Sec 09 Filing Amt": "Sec 09 Filing Amt",
            // *** UPDATED KEYS - MUST MATCH NEW SHEET HEADERS ***
            "Advocate (Sec 09)": "Advocate", // Renamed in Sheet
            "CASE NO (Sec 09)": "CASE NO", // Renamed in Sheet
            "Attachment eff Date": "Attachment eff Date",
        }
    },
    {
        title: "5) Charges",
        fields: {
            "Demand Notice Expense": "Demand Notice Expense",
            "Sec 09 Expense": "Sec 09 Expense",
            "Sec.138 Expense": "Sec.138 Expense",
        }
    }
];

// ====================================================================
// DOM ELEMENTS (Unchanged)
// ====================================================================
const FORM = document.getElementById('record-form');
const MESSAGE_ELEMENT = document.getElementById('submission-message');
const AUTH_KEY_INPUT = document.getElementById('auth-key');
const AUTH_BUTTON = document.querySelector('button[onclick="showInputForm()"]');
const AUTH_LABEL = document.querySelector('label[for="auth-key"]');

const LOAN_INPUT = document.getElementById('loan-no-input');
const SEARCH_BUTTON = document.getElementById('search-button');
const LOADING_STATUS = document.getElementById('loading-status');
const DATA_BLOCKS_CONTAINER = document.getElementById('data-blocks');
const DATA_VIEW_SECTION = document.getElementById('data-view-blocks');
const DISPLAY_LOAN_NO = document.getElementById('display-loan-no');
const NOT_FOUND_MESSAGE = document.getElementById('not-found-message');

const HEADER_INPUT = document.getElementById('header_name'); 
const DATA_INPUT = document.getElementById('data_value');


// ====================================================================
// 1. READ OPERATION (Search Loan by Number)
// ====================================================================

SEARCH_BUTTON.addEventListener('click', searchLoan);

async function searchLoan() {
    const loanNo = LOAN_INPUT.value.trim();
    if (!loanNo) {
        LOADING_STATUS.textContent = 'Please enter a Loan No.';
        return;
    }

    LOADING_STATUS.textContent = `Searching for Loan No: ${loanNo}...`;
    DATA_VIEW_SECTION.style.display = 'none';
    NOT_FOUND_MESSAGE.style.display = 'none';

    try {
        const response = await fetch(`${API_URL}?loan_no=${encodeURIComponent(loanNo)}`, {
            method: 'GET',
            mode: 'cors' 
        });

        const result = await response.json();

        if (result.status === 'success' && result.data && result.data.length > 0) {
            renderBlocks(result.data[0]);
            LOADING_STATUS.textContent = `Data loaded for Loan No: ${loanNo}.`;
        } else {
            LOADING_STATUS.textContent = 'Search complete.';
            DATA_BLOCKS_CONTAINER.innerHTML = '';
            NOT_FOUND_MESSAGE.textContent = `❌ No record found for Loan No: ${loanNo}.`;
            NOT_FOUND_MESSAGE.style.display = 'block';
            DATA_VIEW_SECTION.style.display = 'block';
        }

    } catch (error) {
        console.error("Error fetching data:", error);
        LOADING_STATUS.textContent = '❌ Network Error. Could not connect to API.';
    }
}

function renderBlocks(record) {
    DATA_BLOCKS_CONTAINER.innerHTML = '';
    DISPLAY_LOAN_NO.textContent = record["Loan No"] || 'N/A';
    DATA_VIEW_SECTION.style.display = 'block';

    DISPLAY_BLOCKS.forEach(blockConfig => {
        const block = document.createElement('div');
        block.className = 'data-block';
        
        const title = document.createElement('h3');
        title.textContent = blockConfig.title;
        block.appendChild(title);

        Object.entries(blockConfig.fields).forEach(([sheetHeader, displayName]) => {
            // Note: sheetHeader is the exact key from the Apps Script JSON payload
            const value = record[sheetHeader] !== undefined ? record[sheetHeader] : 'N/A';
            
            const item = document.createElement('div');
            item.className = 'data-block-item';
            
            const label = document.createElement('span');
            label.className = 'item-label';
            label.textContent = `${displayName}:`;
            
            const dataValue = document.createElement('span');
            dataValue.className = 'item-value';
            dataValue.textContent = value;
            
            item.appendChild(label);
            item.appendChild(dataValue);
            block.appendChild(item);
        });

        DATA_BLOCKS_CONTAINER.appendChild(block);
    });
}

// ====================================================================
// 2. UI Toggling (Unchanged)
// ====================================================================

function showInputForm() {
    const enteredKey = AUTH_KEY_INPUT.value;
    
    if (enteredKey === CLIENT_SIDE_AUTH_KEY) {
        FORM.style.display = 'block';
        AUTH_KEY_INPUT.style.display = 'none';
        AUTH_BUTTON.style.display = 'none';
        AUTH_LABEL.textContent = 'Write Access Granted.';
        alert('Write access enabled! Please fill out the form.');
    } else {
        alert('Authorization failed. Please enter the correct secret key.');
        AUTH_KEY_INPUT.value = '';
    }
}


// ====================================================================
// 3. WRITE OPERATION (Single Dynamic Entry) (Unchanged)
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
            MESSAGE_ELEMENT.textContent = `✅ Record successfully saved! Column: ${headerName}`;
            FORM.reset(); 
        } else {
            MESSAGE_ELEMENT.textContent = `❌ Submission Error: ${result.message}`; 
        }

    } catch (error) {
        MESSAGE_ELEMENT.textContent = '❌ Network Error. Could not connect to API.';
        console.error("Submission error:", error);
    }
});


// Start the process when the page loads (no initial fetch is needed now)
// document.addEventListener('DOMContentLoaded', searchLoan);
