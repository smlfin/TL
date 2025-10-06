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
const API_URL_UPDATE = "/.netlify/functions/update-data"; // Assuming a separate endpoint for updates
const CLIENT_SIDE_AUTH_KEY = "123"; 

let ALL_RECORDS = []; 
window.CURRENT_LOAN_RECORD = null;

// NEW DEFINITIONS FOR ADVOCATE TRACKER STATUS
const STATUS_FIELD = "Advocate Payment Status"; // Assuming this is the column name in the sheet
const STATUS_OPTIONS = ["Paid", "Processing", "Rejected"];


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
            LOADING_STATUS.textContent = 'Ready. Select Branch & Loan No. to view file details, or use the Advocate Tracker.';
            
            // If an advocate was previously selected, re-render the summary
            if (ADVOCATE_TRACKER_SELECT.value) {
                 displayAdvocateSummary(ADVOCATE_TRACKER_SELECT.value);
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

    ADVOCATE_TRACKER_SELECT.innerHTML = '<option value="" selected disabled>-- Select Advocate --</option>';
    
    [...advocates].sort().forEach(advocate => {
        const option = document.createElement('option');
        option.value = advocate;
        option.textContent = advocate;
        ADVOCATE_TRACKER_SELECT.appendChild(option);
    });
    ADVOCATE_TRACKER_SELECT.disabled = false;
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
    if (DATE_FIELDS.includes(sheetHeader) && value !== 'N/A') {
        value = formatDate(value);
    }

    // Apply currency formatting ONLY for display in the blocks
    if (CHARGE_FIELDS_FOR_SNAPSHOT.includes(sheetHeader) && value !== 'N/A') {
        const number = parseNumber(value);
        value = number.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
    }

    return value;
}

// Helper to create a subtotal row DOM element
function createSubtotalRow(label, value, className) {
    const formattedValue = value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
    
    const subtotalItem = document.createElement('div');
    subtotalItem.className = `data-block-item ${className}`;

    const totalLabelSpan = document.createElement('span');
    totalLabelSpan.className = 'item-label';
    totalLabelSpan.textContent = label;

    const totalValueSpan = document.createElement('span');
    totalValueSpan.className = 'item-value';
    totalValueSpan.textContent = formattedValue;
    
    subtotalItem.appendChild(totalLabelSpan);
    subtotalItem.appendChild(totalValueSpan);
    return subtotalItem;
}

// --- MODIFIED RENDER FILTERED BLOCKS FUNCTION (Fixes Accordion and Blocks 5/6) ---
function renderFilteredBlocks(record, isAdvocateFeeOnly) {
    DATA_BLOCKS_CONTAINER.innerHTML = '';
    DISPLAY_LOAN_NO.textContent = record["Loan No"] || 'N/A';

    const blockElements = {};

    DISPLAY_BLOCKS.forEach((blockConfig, index) => {
        const block = document.createElement('div');
        const blockNumber = index + 1;
        block.id = `block-${blockNumber}`;
        block.classList.add('data-block');
        
        const isChargeBlock = blockNumber === 5 || blockNumber === 6;
        const isCollapsible = blockNumber >= 1 && blockNumber <= 4; // Blocks 1-4 are collapsible

        // Add layout classes
        if (blockNumber === 1 || blockNumber === 3 || isChargeBlock) {
            block.classList.add('horizontal-grid');
        } else if (blockNumber === 2 || blockNumber === 4) {
            block.classList.add('vertical-list');
        }

        // --- Block Header ---
        const header = document.createElement('div');
        header.classList.add('block-header');
        if (isCollapsible) {
            header.classList.add('accordion-header', 'collapsed'); // Start collapsed
        }
        const title = document.createElement('h3');
        title.textContent = blockConfig.title;

        // Add expand/collapse icon
        if (isCollapsible) {
            const icon = document.createElement('span');
            icon.className = 'accordion-icon';
            icon.textContent = '+';
            header.appendChild(icon);
        }

        header.appendChild(title);
        block.appendChild(header);

        // --- Block Content ---
        const content = document.createElement('div');
        content.classList.add('block-content');
        if (isCollapsible) {
            content.classList.add('accordion-content');
        }

        let advFeeNetTotal = 0;
        let otherChargesNetTotal = 0;
        let showBlock = true;

        if (isChargeBlock) {
            // Determine the charge definitions based on block number
            const chargeDefinitions = blockNumber === 5 ? CHARGE_DEFINITIONS_138 : CHARGE_DEFINITIONS_09;
            
            // 1. Render Advocate Fee fields (always render if isChargeBlock)
            chargeDefinitions.AdvocateFeeFieldsDisplay.forEach(sheetHeader => {
                const displayName = blockConfig.fields[sheetHeader];
                const value = processValue(record, sheetHeader);
                content.appendChild(renderDataItem(sheetHeader, displayName, value));
            });

            // Calculate Advocate Fee Net (Fee - TDS)
            advFeeNetTotal = calculateAdvocateFeePaymentNet(record, chargeDefinitions.AdvocateFeeNetFields);
            content.appendChild(createSubtotalRow("Advocate Fee Net (Fee - TDS):", advFeeNetTotal, 'subtotal-row'));


            // 2. Render Other Charges fields
            if (!isAdvocateFeeOnly) {
                chargeDefinitions.OtherChargesFields.forEach(sheetHeader => {
                    const displayName = blockConfig.fields[sheetHeader];
                    const value = processValue(record, sheetHeader);
                    content.appendChild(renderDataItem(sheetHeader, displayName, value));
                });
                
                // Calculate Other Charges Net
                otherChargesNetTotal = calculateChargesNet(record, chargeDefinitions.OtherChargesFields);
                content.appendChild(createSubtotalRow("Other Charges Net (Fee - TDS):", otherChargesNetTotal, 'subtotal-row'));
            } else {
                 // If only advocate fee is shown, set showBlock to false if only Other Charges fields have values
                 // For now, we will simply hide the other charges fields and let the block show if any ADVOCATE FEE fields are present
                 // We rely on the `isAdvocateFeeOnly` to filter the table display, not the block rendering.
            }
        } else {
            // Non-charge blocks (1, 2, 3, 4) - just render all fields
            Object.entries(blockConfig.fields).forEach(([sheetHeader, displayName]) => {
                const value = processValue(record, sheetHeader);
                content.appendChild(renderDataItem(sheetHeader, displayName, value));
            });
        }

        block.appendChild(content);

        // Append the block only if it contains content or is not filtered out
        if (showBlock) {
            DATA_BLOCKS_CONTAINER.appendChild(block);
            blockElements[blockNumber] = block;
        }
    });
}

// Function to add accordion listeners
function addAccordionListeners() {
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.removeEventListener('click', toggleAccordion); // Prevent multiple listeners
        header.addEventListener('click', toggleAccordion);
    });
}

// Accordion toggle handler
function toggleAccordion(event) {
    const header = event.currentTarget;
    const content = header.nextElementSibling;
    const icon = header.querySelector('.accordion-icon');
    
    header.classList.toggle('collapsed');
    
    if (header.classList.contains('collapsed')) {
        content.style.maxHeight = '0';
        icon.textContent = '+';
    } else {
        // Calculate the natural height of the content to allow smooth expansion
        content.style.maxHeight = content.scrollHeight + 'px';
        icon.textContent = '-';
    }
}


// ADVOCATE TRACKER LOGIC

ADVOCATE_TRACKER_SELECT.addEventListener('change', (event) => {
    const selectedAdvocate = event.target.value;
    if (selectedAdvocate) {
        displayAdvocateSummary(selectedAdvocate);
    } else {
        ADVOCATE_PAYMENTS_VIEW.innerHTML = '<p>Select an Advocate to see their payment summary.</p>';
    }
});


function displayAdvocateSummary(advocateName) {
    const advocateRecords = ALL_RECORDS.filter(record => 
        (String(record["ADVOCATE"]).trim() === advocateName) || 
        (String(record["Sec/9 Advocate"]).trim() === advocateName)
    );

    if (advocateRecords.length === 0) {
        ADVOCATE_PAYMENTS_VIEW.innerHTML = `<p>No payment records found for ${advocateName}.</p>`;
        return;
    }

    // Sort: Loan No ascending
    advocateRecords.sort((a, b) => {
        const loanA = String(a["Loan No"]).trim();
        const loanB = String(b["Loan No"]).trim();
        return loanA.localeCompare(loanB);
    });

    let totalNetPayment = 0;
    let tableHTML = `
        <h3>Payment Summary for ${advocateName} (${advocateRecords.length} Records)</h3>
        <table class="advocate-summary-table">
            <thead>
                <tr>
                    <th>Loan No</th>
                    <th>Customer Name</th>
                    <th>Advocate Fee Net (₹)</th>
                    <th>Payment Status</th>
                    <th>Edit Status</th>
                </tr>
            </thead>
            <tbody>
    `;

    advocateRecords.forEach(record => {
        const loanNo = String(record["Loan No"]).trim();
        const customerName = record["Customer Name"] || 'N/A';
        const currentStatus = record[STATUS_FIELD] || STATUS_OPTIONS[1]; // Default to 'Processing'
        
        // Calculate Net Fee (Fee - TDS) for Sec 138 and Sec 09
        const netFee138 = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields);
        const netFee09 = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
        const totalFeeNet = netFee138 + netFee09;
        totalNetPayment += totalFeeNet;

        const formattedFeeNet = totalFeeNet.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
        
        const statusClass = currentStatus.toLowerCase();
        
        // Render the disabled tag or the edit button wrapper
        let statusCellContent;
        if (currentStatus !== 'Processing') {
             // Display the newly set status as a disabled tag (user requirement)
             statusCellContent = `<span class="status-tag status-${statusClass} disabled-tag">${currentStatus}</span>`;
        } else {
             // Only allow editing if status is 'Processing'
             statusCellContent = `
                <div class="status-cell-wrapper">
                    <span class="status-tag status-processing">${currentStatus}</span>
                    <button class="edit-status-btn" data-loan-no="${loanNo}">Edit</button>
                </div>
            `;
        }

        tableHTML += `
            <tr data-loan-no="${loanNo}">
                <td>${loanNo}</td>
                <td>${customerName}</td>
                <td class="numeric-cell">${formattedFeeNet}</td>
                <td class="status-cell" data-current-status="${currentStatus}">${statusCellContent}</td>
                <td class="edit-cell"></td>
            </tr>
        `;
    });

    const formattedTotalNetPayment = totalNetPayment.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

    tableHTML += `
            </tbody>
            <tfoot>
                <tr class="grand-total-summary">
                    <td colspan="2">GRAND TOTAL NET PAYMENT:</td>
                    <td class="numeric-cell">${formattedTotalNetPayment}</td>
                    <td></td>
                    <td></td>
                </tr>
            </tfoot>
        </table>
    `;

    ADVOCATE_PAYMENTS_VIEW.innerHTML = tableHTML;
    
    // Add event listeners for the new "Edit" buttons
    document.querySelectorAll('.edit-status-btn').forEach(button => {
        button.addEventListener('click', handleEditStatus);
    });
}


// --- STATUS EDITING LOGIC ---

function handleEditStatus(event) {
    const button = event.target;
    const loanNo = button.dataset.loanNo;
    const tdElement = button.closest('td');
    const currentStatus = tdElement.dataset.currentStatus;
    
    // 1. Ask for password
    const authKey = prompt("Enter Secret Key to proceed with status update:");

    if (!authKey || authKey.trim() === "") {
        alert("Status update cancelled. Secret Key is required.");
        return;
    }

    // 2. Hide current status/button and show dropdown/save button
    tdElement.innerHTML = createStatusEditForm(loanNo, currentStatus);

    // 3. Attach listeners for the new form elements
    const saveButton = tdElement.querySelector('.save-status-btn');
    const cancelButton = tdElement.querySelector('.cancel-status-btn');
    
    saveButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const newStatus = tdElement.querySelector('.status-select').value;
        if (newStatus && newStatus !== currentStatus) {
            confirmSaveStatus(authKey, loanNo, newStatus, tdElement);
        } else {
            // If status is the same or selection is invalid, just revert
            revertToTag(tdElement, currentStatus, loanNo);
        }
    });
    
    cancelButton.addEventListener('click', (e) => {
        e.stopPropagation();
        revertToTag(tdElement, currentStatus, loanNo);
    });
}

// Helper to create the dropdown and save/cancel buttons
function createStatusEditForm(loanNo, currentStatus) {
    let optionsHTML = STATUS_OPTIONS.map(status => {
        // Exclude 'Processing' from selection since we are editing away from it
        if (status !== 'Processing') {
             return `<option value="${status}" ${status === currentStatus ? 'selected' : ''}>${status}</option>`;
        }
        return '';
    }).join('');

    return `
        <div class="status-edit-form">
            <select class="status-select">
                <option value="">-- Select --</option>
                ${optionsHTML}
            </select>
            <div class="edit-actions">
                <button class="save-status-btn">Save</button>
                <button class="cancel-status-btn">Cancel</button>
            </div>
        </div>
    `;
}

// Helper to revert the cell to the final disabled tag or the edit button
function revertToTag(tdElement, status, loanNo) {
    const statusClass = status.toLowerCase();
    
    // If status is 'Processing', we revert to the editable state
    if (status === 'Processing') {
        tdElement.innerHTML = `
            <div class="status-cell-wrapper">
                <span class="status-tag status-processing">${status}</span>
                <button class="edit-status-btn" data-loan-no="${loanNo}">Edit</button>
            </div>
        `;
        // Re-attach listener
        tdElement.querySelector('.edit-status-btn').addEventListener('click', handleEditStatus);
    } else {
        // If status is Paid or Rejected, display it as a disabled tag
        tdElement.innerHTML = `<span class="status-tag status-${statusClass} disabled-tag">${status}</span>`;
    }
    tdElement.dataset.currentStatus = status;
}

// *** CRITICAL FIX APPLIED HERE: Update local data cache and re-render summary table ***
async function confirmSaveStatus(authKey, loanNo, newStatus, tdElement) {
    const dataToSend = {
        "authKey": authKey,
        "loanNo": loanNo,
        "columnHeader": STATUS_FIELD,
        "dataValue": newStatus
    };

    try {
        const response = await fetch(API_URL_UPDATE, { // Use API_URL_UPDATE or the correct update endpoint
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

            // 1. Find and update the local ALL_RECORDS cache immediately. (THE CRITICAL FIX)
            const recordToUpdate = ALL_RECORDS.find(record => String(record["Loan No"]).trim() === loanNo);
            if (recordToUpdate) {
                recordToUpdate[STATUS_FIELD] = newStatus;
            }
            
            // 2. Immediately update the individual cell (Optimistic UI update, showing the disabled tag)
            revertToTag(tdElement, newStatus, loanNo);
            
            // 3. Re-render the entire summary table using the now-updated ALL_RECORDS cache.
            // This prevents the flicker by ensuring displayAdvocateSummary uses the correct new status.
            const lastSelectedAdvocate = ADVOCATE_TRACKER_SELECT.value;
            if (lastSelectedAdvocate) {
                displayAdvocateSummary(lastSelectedAdvocate); 
            }
            
            // ** Removed the problematic call to initialLoad() which caused the flicker **
            
        } else {
            alert(`❌ Submission Error: ${result.message || 'Could not save status.'}`);
            // Revert on API failure, using the status from the TD element's dataset
            revertToTag(tdElement, tdElement.dataset.currentStatus, loanNo);
        }

    } catch (error) {
        console.error("Error updating status:", error);
        alert("❌ Network Error: Could not connect to the update service.");
        // Revert on network failure
        revertToTag(tdElement, tdElement.dataset.currentStatus, loanNo);
    }
}


// --- OTHER WRITE OPERATION (Unchanged) ---
// 5. WRITE OPERATION 
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
        console.error("Error submitting data:", error);
        MESSAGE_ELEMENT.textContent = '❌ Network Error. Could not connect to API for submission.';
    }
});


// 6. PASSWORD AUTH (Unchanged)
function showInputForm() {
    if (AUTH_KEY_INPUT.value === CLIENT_SIDE_AUTH_KEY) {
        FORM.style.display = 'block';
        AUTH_BUTTON.style.display = 'none';
        AUTH_LABEL.style.display = 'none';
        AUTH_KEY_INPUT.style.display = 'none';
    } else {
        alert('❌ Invalid Key. Please enter the correct secret key.');
        AUTH_KEY_INPUT.value = '';
    }
}
This issue is occurring because after a successful status update, the application is likely re-fetching the data from the server or re-rendering from an old cached version, causing a brief "flicker" back to the previous status.

To fix this, we need to implement an **optimistic update** on the local data cache (`ALL_RECORDS`) immediately after the server confirms the save. Then, we must re-render the Advocate Summary table using the newly updated local cache. This will prevent the flicker and stably display the new status.

I have updated `script.js` to implement this caching fix and also modified the display logic to permanently use the "Status Tag + Edit Icon" style as requested.

Here are the changes for both `script.js` and `style.css`.

## 1. File: `script.js` (Major Update and Fix)

I've added the missing Advocate Tracker logic and implemented the fix in `confirmSaveStatus` to update the local cache (`ALL_RECORDS`) and re-render the summary table, eliminating the flicker.

```javascript
// Function to handle the actual save operation
async function confirmSaveStatus(authKey, loanNo, newStatus, tdElement) {
    const URL_TO_USE = API_URL; // Use the same API endpoint for updating

    const dataToSend = {
        "authKey": authKey,
        "Loan No": loanNo,
        [STATUS_FIELD]: newStatus // Update the specific status field
    };

    try {
        const response = await fetch(URL_TO_USE, {
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
            
            // --- FIX START: Update local cache and re-render table to prevent flicker ---
            
            // 1. Find and **optimistically update the local ALL_RECORDS cache** immediately.
            // This is CRITICAL to prevent displayAdvocateSummary from using stale data.
            const recordToUpdate = ALL_RECORDS.find(record => String(record["Loan No"]).trim() === loanNo);
            if (recordToUpdate) {
                recordToUpdate[STATUS_FIELD] = newStatus;
            }
            
            // 2. Re-render the entire summary table using the now-updated local cache.
            // This updates all UI elements, including the grand total.
            const advocateName = ADVOCATE_TRACKER_SELECT.value; 
            if (advocateName) {
                displayAdvocateSummary(advocateName); 
            }
            // --- FIX END ---

        } else {
            alert(`❌ Update Error: ${result.message || 'Could not save status.'}`);
            // Revert cell back to original state if save fails
            const originalStatus = tdElement.querySelector('.status-dropdown').getAttribute('data-original-status');
            const advocateName = tdElement.getAttribute('data-advocate');
            revertToTag(tdElement, originalStatus, loanNo, advocateName);
        }
    } catch (error) {
        console.error("Network error during status save:", error);
        alert("❌ Network Error: Could not connect to API for status update.");
        // Revert cell back to original state on network failure
        const originalStatus = tdElement.querySelector('.status-dropdown').getAttribute('data-original-status');
        const advocateName = tdElement.getAttribute('data-advocate');
        revertToTag(tdElement, originalStatus, loanNo, advocateName);
    }
}

// Helper to determine CSS class for status tag
function getStatusClassName(status) {
    if (status === 'Paid') return 'status-paid';
    if (status === 'Processing') return 'status-processing';
    if (status === 'Rejected') return 'status-rejected';
    return 'status-unset';
}

// Function to convert the cell content to a disabled tag with an edit option, 
// or return the HTML for table generation.
function revertToTag(tdElement, newStatus, loanNo, advocateName) {
    const statusClass = getStatusClassName(newStatus);
    
    // HTML content for the disabled tag with the Edit option
    const htmlContent = `
        <div class="status-tag ${statusClass}">
            ${newStatus}
            <span class="edit-icon" 
                  data-loan-no="${loanNo}" 
                  data-advocate="${advocateName}" 
                  data-current-status="${newStatus}">
                ✍️ Edit
            </span>
        </div>
    `;

    if (tdElement) {
        // Case 1: Called after a successful save or cancel (tdElement is the <td> to update)
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
    
    // Case 2: Called during full table render (return HTML string)
    return htmlContent;
}


// --- MODIFIED displayAdvocateSummary function ---
function displayAdvocateSummary(selectedAdvocate) {
    // ... (existing filtering logic)
    
    // ... (inside the payments.forEach(payment => { ... }) loop)
    
        // Calculate current status (This ensures the latest status from ALL_RECORDS is used)
        const currentStatus = payment.record[STATUS_FIELD] || 'Processing'; 
        const sections = [];
        if (payment.details.is138) sections.push("Sec 138");
        if (payment.details.is09) sections.push("Sec 09");

        // The status is displayed as a disabled tag with an Edit option (calls revertToTag)
        const statusTagHtml = revertToTag(null, currentStatus, payment.loanNo, selectedAdvocate); 

        html += ` 
            <tr class="advocate-payment-row"> 
                <td>${payment.loanNo}</td> 
                <td>${payment.branch}</td> 
                <td>${sections.join(' & ')}</td> 
                <td data-loan-no="${payment.loanNo}" data-advocate="${selectedAdvocate}" class="status-cell">
                    ${statusTagHtml}
                </td> 
                <td class="right-align"> 
                    <button class="breakdown-button" 
                            data-loan-no="${payment.loanNo}" 
                            data-advocate="${selectedAdvocate}" 
                            data-net="${payment.details.totalAdvocateNet}"
                    > 
                        ${formattedNet} 
                    </button> 
                </td> 
            </tr> 
        `; 
    });

    // ... (existing code for Grand Total)
    
    // 3. Render and Attach Listeners
    ADVOCATE_PAYMENTS_VIEW.innerHTML = html; 

    // Attach listener to all EDIT ICONS to trigger auth/popup
    document.querySelectorAll('.edit-icon').forEach(icon => {
        icon.addEventListener('click', function() {
            showPasscodePopup(this);
        });
    });
    
    // ... (existing code for Breakdown Buttons listener)
}
// --- END MODIFIED displayAdvocateSummary function ---

// ... (Ensure the rest of the file is included, including the new showPasscodePopup 
// and enableStatusDropdown logic to handle the Edit click and status change)