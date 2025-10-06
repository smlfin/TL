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

// NEW FIX: Add Event Listener for Advocate Tracker
ADVOCATE_TRACKER_SELECT.addEventListener('change', displayAdvocateSummary);

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

// Function to render the blocks view for a single loan
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
        header.appendChild(title);

        if (isCollapsible) {
            const icon = document.createElement('span');
            icon.classList.add('accordion-icon');
            icon.textContent = '▶'; // Right arrow icon
            header.appendChild(icon);
        }
        block.appendChild(header);

        // --- Content Wrapper (Collapsible or Always Expanded) ---
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'data-block-content-wrapper';
        if (isCollapsible) {
            contentWrapper.classList.add('accordion-content');
        } else {
            contentWrapper.classList.add('always-expanded'); // Blocks 5/6 always visible
        }

        const innerContent = document.createElement('div');
        innerContent.className = 'data-block-content';
        
        let allFields = Object.entries(blockConfig.fields);
        let fieldsToRender = allFields;


        // 1. Rendering Logic for All Blocks (including Charge Blocks 5 & 6)
        if (isChargeBlock) {
            const definitions = blockNumber === 5 ? CHARGE_DEFINITIONS_138 : CHARGE_DEFINITIONS_09;

            // Use the full display list for rendering individual items
            const allChargeFieldsDisplay = [...definitions.AdvocateFeeFieldsDisplay, ...definitions.OtherChargesFields];

            if (isAdvocateFeeOnly) {
                // TOGGLE ON: Filter to show only Advocate Fee related fields
                fieldsToRender = allChargeFieldsDisplay.filter(sheetHeader => definitions.AdvocateFeeFieldsDisplay.includes(sheetHeader));
            } else {
                // TOGGLE OFF: Show all charge fields
                fieldsToRender = allChargeFieldsDisplay;
            }

            // Render charge fields
            fieldsToRender.forEach(sheetHeader => {
                const displayName = blockConfig.fields[sheetHeader];
                const value = processValue(record, sheetHeader);
                innerContent.appendChild(renderDataItem(sheetHeader, displayName, value));
            });

        } else {
            // Standard blocks (1, 2, 3, 4): render all fields
            fieldsToRender.forEach(([sheetHeader, displayName]) => {
                const value = processValue(record, sheetHeader);
                innerContent.appendChild(renderDataItem(sheetHeader, displayName, value));
            });
        }


        // 2. Append Subtotal Rows for Charge Blocks (5 & 6)
        if (isChargeBlock) {
            const definitions = blockNumber === 5 ? CHARGE_DEFINITIONS_138 : CHARGE_DEFINITIONS_09;
            const sectionName = blockNumber === 5 ? "Section 138" : "Section 09";

            // 1. Advocate Fee Net: Use the new function (Fee - TDS, NO GST)
            const advFeeNetTotal = calculateAdvocateFeePaymentNet(record, definitions.AdvocateFeeNetFields);
            
            // 2. Other Charges Net: Use the old function (Simple sum of other charges, NO TDS involved here)
            const otherChargesNetTotal = calculateChargesNet(record, definitions.OtherChargesFields.map(f => f));

            if (isAdvocateFeeOnly) {
                // TOGGLE ON: Only show one total row (Advocate Fee Total)
                const totalItem = createSubtotalRow(
                    `${sectionName} Advocate Fee Total (Net of TDS)`, 
                    advFeeNetTotal, 
                    'subtotal-row section-grand-total'
                );
                innerContent.appendChild(totalItem);
            } else {
                // TOGGLE OFF: Show all three required subtotal rows
                
                // Subtotal 1: Advocate Fee Net (Fee - TDS)
                const advFeeItem = createSubtotalRow(
                    "Advocate Fee Net (Fee - TDS)", 
                    advFeeNetTotal, 
                    'subtotal-row advocate-fee-net'
                );
                innerContent.appendChild(advFeeItem);

                // Subtotal 2: Other Charges Net (Sum of all other charges)
                const otherChargesItem = createSubtotalRow(
                    "Other Charges Net", 
                    otherChargesNetTotal, 
                    'subtotal-row other-charges-net'
                );
                innerContent.appendChild(otherChargesItem);

                // Subtotal 3: Sub Section Total
                const subSectionTotal = advFeeNetTotal + otherChargesNetTotal;
                const totalItem = createSubtotalRow(
                    `${sectionName} Sub Section Total (Net)`, 
                    subSectionTotal, 
                    'subtotal-row section-grand-total'
                );
                innerContent.appendChild(totalItem);
            }
        }
        
        // Finalize block content
        contentWrapper.appendChild(innerContent);
        block.appendChild(contentWrapper);
        blockElements[`block${blockNumber}`] = block;
    });

    // --- Dynamic Layout Arrangement ---
    // Section 1 is full width
    DATA_BLOCKS_CONTAINER.appendChild(blockElements.block1);

    // Sections 2 and 4 are side-by-side
    const detailContentGrid = document.createElement('div');
    detailContentGrid.id = 'detail-content-grid';
    detailContentGrid.appendChild(blockElements.block2);
    detailContentGrid.appendChild(blockElements.block4);
    DATA_BLOCKS_CONTAINER.appendChild(detailContentGrid);

    // Sections 3, 5, 6 are full width
    DATA_BLOCKS_CONTAINER.appendChild(blockElements.block3);
    DATA_BLOCKS_CONTAINER.appendChild(blockElements.block5);
    DATA_BLOCKS_CONTAINER.appendChild(blockElements.block6);
}

// Function to handle the accordion toggle
function addAccordionListeners() {
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.onclick = function() {
            const content = this.nextElementSibling;
            
            this.classList.toggle('expanded');
            content.classList.toggle('expanded');

            // Find and rotate the icon
            const icon = this.querySelector('.accordion-icon');
            if (icon) {
                icon.textContent = this.classList.contains('expanded') ? '▼' : '▶';
            }
        };
    });
}

// Toggles the view between 'All Charges' and 'Advocate Fee Only'
ADVOCATE_FEE_TOGGLE.addEventListener('change', (e) => {
    if (window.CURRENT_LOAN_RECORD) {
        renderFilteredBlocks(window.CURRENT_LOAN_RECORD, e.target.checked);
    }
});


// --- 4. ADVOCATE TRACKER LOGIC (FIX: Implemented missing logic) ---
function displayAdvocateSummary() {
    const selectedAdvocate = ADVOCATE_TRACKER_SELECT.value;
    ADVOCATE_PAYMENTS_VIEW.innerHTML = ''; // Clear previous content

    if (!selectedAdvocate) {
        ADVOCATE_PAYMENTS_VIEW.innerHTML = '<p>Select an Advocate to see their payment summary.</p>';
        return;
    }

    // Filter records for the selected advocate in either Section 138 or Section 09
    const advocateRecords = ALL_RECORDS.filter(record => {
        const adv138 = String(record["ADVOCATE"]).trim();
        const adv09 = String(record["Sec/9 Advocate"]).trim();
        return adv138 === selectedAdvocate || adv09 === selectedAdvocate;
    });

    if (advocateRecords.length === 0) {
        ADVOCATE_PAYMENTS_VIEW.innerHTML = `<p>No records found for Advocate: <strong>${selectedAdvocate}</strong>.</p>`;
        return;
    }

    let totalAdvocateFeePaid = 0;
    
    // Start generating the table
    let tableHTML = `
        <table class="advocate-summary-table">
            <thead>
                <tr>
                    <th>Loan No</th>
                    <th>Branch</th>
                    <th>Section</th>
                    <th>Fee Net (INR)</th>
                    <th>Other Charges Net (INR)</th>
                    <th class="status-column">Status</th>
                </tr>
            </thead>
            <tbody>
    `;

    // Helper function to format currency (non-signed, for table display)
    const formatCurrency = (amount) => {
        const number = parseNumber(amount);
        return number.toLocaleString('en-IN', { minimumFractionDigits: 2 });
    };

    advocateRecords.forEach(record => {
        const loanNo = record["Loan No"];
        const loanBranch = record["Loan Branch"];

        // Check for Sec 138 fees
        const advFee138Net = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields);
        const otherCharges138Net = calculateChargesNet(record, CHARGE_DEFINITIONS_138.OtherChargesFields.map(f => f));
        
        // Check for Sec 09 fees
        const advFee09Net = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
        const otherCharges09Net = calculateChargesNet(record, CHARGE_DEFINITIONS_09.OtherChargesFields.map(f => f));
        
        // FIX: Read the status field, default to 'N/A' and create a safe CSS class
        const paymentStatus = String(record[STATUS_FIELD]).trim() || 'N/A'; 
        
        // Standardize status class for CSS (e.g., "Paid" -> "paid", "Processing" -> "processing")
        const statusClass = paymentStatus.toLowerCase().replace(/\s/g, '-').replace(/[^a-z0-9-]/g, '');


        // If there are fees for Sec 138 AND the advocate is the one assigned to 138
        if (advFee138Net !== 0 && String(record["ADVOCATE"]).trim() === selectedAdvocate) {
            totalAdvocateFeePaid += advFee138Net;
            tableHTML += `
                <tr>
                    <td>${loanNo}</td>
                    <td>${loanBranch}</td>
                    <td>Section 138</td>
                    <td class="currency-value">${formatCurrency(advFee138Net)}</td>
                    <td class="currency-value">${formatCurrency(otherCharges138Net)}</td>
                    <td><span class="status-tag status-${statusClass}">${paymentStatus}</span></td>
                </tr>
            `;
        }

        // If there are fees for Sec 09 AND the advocate is the one assigned to 09
        if (advFee09Net !== 0 && String(record["Sec/9 Advocate"]).trim() === selectedAdvocate) {
            totalAdvocateFeePaid += advFee09Net;
            tableHTML += `
                <tr>
                    <td>${loanNo}</td>
                    <td>${loanBranch}</td>
                    <td>Section 09</td>
                    <td class="currency-value">${formatCurrency(advFee09Net)}</td>
                    <td class="currency-value">${formatCurrency(otherCharges09Net)}</td>
                    <td><span class="status-tag status-${statusClass}">${paymentStatus}</span></td>
                </tr>
            `;
        }
    });

    tableHTML += `
            </tbody>
            <tfoot>
                <tr class="advocate-grand-total">
                    <td colspan="3">TOTAL ADVOCATE FEE (NET OF TDS)</td>
                    <td class="currency-value">${formatCurrency(totalAdvocateFeePaid)}</td>
                    <td></td>
                    <td></td>
                </tr>
            </tfoot>
        </table>
    `;
    
    // Total amount display should be currency formatted with symbol
    const formattedTotalFee = totalAdvocateFeePaid.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

    // Add a summary view on top
    const summaryHeader = `
        <div class="grand-total-summary">
            <span>Total Net Fee for ${selectedAdvocate}:</span>
            <span class="total-value">${formattedTotalFee}</span>
        </div>
    `;

    ADVOCATE_PAYMENTS_VIEW.innerHTML = summaryHeader + tableHTML;
}


// --- 5. AUTHENTICATION & WRITE LOGIC (Unchanged) ---
function showInputForm() {
    if (AUTH_KEY_INPUT.value === CLIENT_SIDE_AUTH_KEY) {
        FORM.style.display = 'grid';
        AUTH_KEY_INPUT.style.display = 'none';
        AUTH_BUTTON.style.display = 'none';
        if (AUTH_LABEL) AUTH_LABEL.style.display = 'none';
        MESSAGE_ELEMENT.textContent = 'Input enabled. Select a loan to write data against, or enter a new column name.';
    } else {
        alert('Access Denied. Please enter the correct secret key.');
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
        console.error('Submission error:', error);
        MESSAGE_ELEMENT.textContent = '❌ Network Error. Could not submit data.';
    }
});