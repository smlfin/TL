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
// --- BLOCK B: ADVOCATE TRACKER EVENT LISTENER (NEW) ---
ADVOCATE_TRACKER_SELECT.addEventListener('change', (e) => {
    const advocateName = e.target.value;
    if (advocateName) {
        getAdvocatePaymentDetails(advocateName);
    } else {
        ADVOCATE_PAYMENTS_VIEW.innerHTML = '<p>Select an Advocate to see their payment summary.</p>';
    }
});

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

        // --- Filtering and Rendering Logic for All Blocks (including Charge Blocks 5 & 6) ---
        
        if (isChargeBlock) {
            const definitions = blockNumber === 5 ? CHARGE_DEFINITIONS_138 : CHARGE_DEFINITIONS_09;
            // Use the full display list for rendering individual items
            const allChargeFieldsDisplay = [...definitions.AdvocateFeeFieldsDisplay, ...definitions.OtherChargesFields];
            
            // Generate list of fields to render
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
                    advFeeNetTotal, // Use the new Fee - TDS total
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

        contentWrapper.appendChild(innerContent);
        block.appendChild(contentWrapper);
        blockElements[blockNumber] = block;
    });

    // 3. Assemble the DOM structure in the correct order: B1, Grid (B2, B4), B3, B5, B6
    
    const detailGridWrapper = document.createElement('div');
    detailGridWrapper.id = 'detail-content-grid';
    
    if (blockElements[2]) detailGridWrapper.appendChild(blockElements[2]);
    if (blockElements[4]) detailGridWrapper.appendChild(blockElements[4]);
    
    DATA_BLOCKS_CONTAINER.innerHTML = '';
    
    if (blockElements[1]) DATA_BLOCKS_CONTAINER.appendChild(blockElements[1]);
    if (detailGridWrapper.children.length > 0) {
        DATA_BLOCKS_CONTAINER.appendChild(detailGridWrapper);
    }
    if (blockElements[3]) DATA_BLOCKS_CONTAINER.appendChild(blockElements[3]);
    if (blockElements[5]) DATA_BLOCKS_CONTAINER.appendChild(blockElements[5]);
    if (blockElements[6]) DATA_BLOCKS_CONTAINER.appendChild(blockElements[6]);
}
// --- END MODIFIED RENDER FILTERED BLOCKS FUNCTION ---


// --- NEW ADVOCATE PAYMENT TRACKER LOGIC ---

ADVOCATE_TRACKER_SELECT.addEventListener('change', (e) => {
    const selectedAdvocate = e.target.value;
    if (selectedAdvocate) {
        displayAdvocatePayments(selectedAdvocate);
    } else {
        ADVOCATE_PAYMENTS_VIEW.innerHTML = '<p>Select an Advocate to see their payment summary.</p>';
    }
});

// Helper function to get the payment breakdown for a single loan/advocate
function getAdvocatePaymentDetails(record, advocateName) {
    const adv138Name = String(record["ADVOCATE"]).trim();
    const adv09Name = String(record["Sec/9 Advocate"]).trim();
    
    let sec138Net = 0;
    let sec09Net = 0;

    // Calculate Sec 138 fees if the selected advocate is the Sec 138 advocate
    if (adv138Name === advocateName) {
        // Use the new calculation: Fee - TDS, NO GST
        sec138Net = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields);
    }
    
    // Calculate Sec 09 fees if the selected advocate is the Sec 09 advocate
    if (adv09Name === advocateName) {
        // Use the new calculation: Fee - TDS, NO GST
        sec09Net = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
    }
    
    // Combine the amounts for the final net payment for this advocate on this loan
    const totalAdvocateNet = sec138Net + sec09Net;
    
    return {
        sec138Net,
        sec09Net,
        totalAdvocateNet,
        is138: adv138Name === advocateName,
        is09: adv09Name === advocateName,
        // Also return the full fields display list for the breakdown popup
        sec138Fields: CHARGE_DEFINITIONS_138.AdvocateFeeFieldsDisplay,
        sec09Fields: CHARGE_DEFINITIONS_09.AdvocateFeeFieldsDisplay,
    };
}


function displayAdvocatePayments(selectedAdvocate) {
    ADVOCATE_PAYMENTS_VIEW.innerHTML = `<p>Loading payments for <b>${selectedAdvocate}</b>...</p>`;
    
    let grandTotal = 0;
    const loanPayments = [];

    // 1. Filter Records and Calculate Payments
    ALL_RECORDS.forEach(record => {
        const adv138Name = String(record["ADVOCATE"]).trim();
        const adv09Name = String(record["Sec/9 Advocate"]).trim();
        
        // Only include loans where the selected advocate is involved
        if (adv138Name === selectedAdvocate || adv09Name === selectedAdvocate) {
            const details = getAdvocatePaymentDetails(record, selectedAdvocate);
            
            // Only list loans with a non-zero payment amount
            if (details.totalAdvocateNet !== 0) {
                loanPayments.push({
                    loanNo: record["Loan No"],
                    branch: record["Loan Branch"],
                    details: details,
                    fullRecord: record 
                });
                grandTotal += details.totalAdvocateNet;
            }
        }
    });
    
    // 2. Render Results
    let html = `<h3>Payment Summary for: <span class="total-color-text">${selectedAdvocate}</span></h3>`;

    if (loanPayments.length === 0) {
        html += `<p style="color: var(--color-danger); font-weight: bold;">No net payments found for ${selectedAdvocate} across all loans.</p>`;
        ADVOCATE_PAYMENTS_VIEW.innerHTML = html;
        return;
    }
    
    // Payments Table
    html += `
        <table id="advocate-payments-table">
            <thead>
                <tr>
                    <th>Loan No</th>
                    <th>Branch</th>
                    <th>Section(s)</th>
                    <th>Status</th> <th class="right-align">Advocate Net</th>
                </tr>
            </thead>
            <tbody>
    `;

    loanPayments.sort((a, b) => (a.loanNo > b.loanNo) ? 1 : -1); // Sort by Loan No.
    
    loanPayments.forEach(payment => {
        const sections = [];
        if (payment.details.is138) sections.push("Sec 138");
        if (payment.details.is09) sections.push("Sec 09");

        const formattedNet = payment.details.totalAdvocateNet.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
        
        // NEW STATUS DROPDOWN RENDERING
        const currentStatus = String(payment.fullRecord[STATUS_FIELD] || 'Unset').trim();
        const statusOptionsHtml = STATUS_OPTIONS.map(opt => 
            `<option value="${opt}" ${opt === currentStatus ? 'selected' : ''}>${opt}</option>`
        ).join('');
        
        const statusDropdownHtml = `
            <select class="status-dropdown" 
                    data-loan-no="${payment.loanNo}" 
                    data-advocate="${selectedAdvocate}"
                    data-original-status="${currentStatus}"
                    disabled
            >
                <option value="Unset" ${currentStatus === 'Unset' ? 'selected' : ''} disabled>-- ${currentStatus} --</option>
                ${statusOptionsHtml}
            </select>
        `;

        html += `
            <tr>
                <td>${payment.loanNo}</td>
                <td>${payment.branch}</td>
                <td>${sections.join(' & ')}</td>
                <td>${statusDropdownHtml}</td> <td class="right-align">
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
    
    // Grand Total Row
    const formattedGrandTotal = grandTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
    html += `
            </tbody>
            <tfoot>
                <tr>
                    <td colspan="4" class="right-align total-label">GRAND TOTAL:</td>
                    <td class="right-align total-value">${formattedGrandTotal}</td>
                </tr>
            </tfoot>
        </table>
    `;

    // 3. Render and Attach Listeners
    ADVOCATE_PAYMENTS_VIEW.innerHTML = html;
    
    // NEW: Add listener to all disabled dropdowns to trigger auth
    document.querySelectorAll('.status-dropdown').forEach(select => {
        select.addEventListener('mousedown', function(e) {
            // Prevent the dropdown from opening immediately if disabled
            if (this.disabled) {
                e.preventDefault(); 
                showPasscodePopup(this);
            }
        });
    });

    document.querySelectorAll('.breakdown-button').forEach(button => {
        button.addEventListener('click', (e) => showPaymentBreakdownPopup(e.target, selectedAdvocate));
    });
}

// NEW FUNCTION: Targeted write operation for status
async function updatePaymentStatus(loanNo, newStatus, selectElement) {
    const dataToSend = {};
    // Key to identify the record is Loan No.
    dataToSend["Loan No"] = loanNo; 
    // The column to update
    dataToSend[STATUS_FIELD] = newStatus; 
    // The auth key is needed for the write function
    dataToSend["authKey"] = CLIENT_SIDE_AUTH_KEY; 

    // Visually update the dropdown text while waiting
    selectElement.querySelector('option[disabled]').textContent = `...${newStatus}...`;

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
            // Success: Update the UI to reflect the new, confirmed status
            const currentAdvocate = ADVOCATE_TRACKER_SELECT.value;
            if (currentAdvocate) {
                // A full reload of the data is the safest way to refresh the UI and ALL_RECORDS
                await initialLoad();
                 // Re-select the advocate to refresh the table with fresh data
                displayAdvocatePayments(currentAdvocate);
            }
            
        } else {
            // Failure: Reset the dropdown to its last value and show an error
            alert(`❌ Status Update Error for Loan ${loanNo}: ${result.message}. Please try again.`);
            selectElement.disabled = true;
            selectElement.classList.remove('authorized-active');
            // Re-render the table to reset the UI safely
            displayAdvocatePayments(ADVOCATE_TRACKER_SELECT.value);
        }

    } catch (error) {
        alert(`❌ Network Error. Could not update status for Loan ${loanNo}.`);
        console.error("Status update error:", error);
        // Re-render the table to reset the UI safely
        displayAdvocatePayments(ADVOCATE_TRACKER_SELECT.value);
    }
}

// NEW FUNCTION: Show Passcode Popup and handle authentication
function showPasscodePopup(selectElement) {
    const loanNo = selectElement.getAttribute('data-loan-no');
    
    const popupHTML = `
        <div id="passcode-modal" class="modal-overlay">
            <div class="modal-content small-modal">
                <span class="close-button">&times;</span>
                <h4>Authorize Status Change for Loan ${loanNo}</h4>
                <p>Enter the passcode to enable the status dropdown:</p>
                <input type="password" id="status-passcode-input" placeholder="Passcode">
                <button id="passcode-submit-button">Submit</button>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', popupHTML);
    const modal = document.getElementById('passcode-modal');
    const input = document.getElementById('status-passcode-input');
    const submitButton = document.getElementById('passcode-submit-button');
    const originalStatus = selectElement.getAttribute('data-original-status');

    setTimeout(() => input.focus(), 100);

    const closeModal = () => modal.remove();
    
    modal.querySelector('.close-button').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeModal();
        }
    });

    const attemptAuth = () => {
        const enteredKey = input.value;
        if (enteredKey === CLIENT_SIDE_AUTH_KEY) {
            
            // 1. SUCCESS: Enable the dropdown and highlight
            selectElement.disabled = false;
            selectElement.classList.add('authorized-active');
            // Change disabled option text to reflect that a selection is now possible
            selectElement.querySelector('option[disabled]').textContent = `-- Select New Status --`;
            
            // 2. Open the dropdown visually (trick to make it look like it was clicked)
            const event = new MouseEvent('mousedown');
            selectElement.dispatchEvent(event);

            // 3. Remove the modal
            closeModal(); 
            
            // 4. Attach ONE-TIME change listener
            setTimeout(() => {
                 selectElement.addEventListener('change', function oneTimeChangeHandler() {
                    const newStatus = this.value;
                    
                    // a) Immediately disable the dropdown again and remove active class
                    this.disabled = true;
                    this.classList.remove('authorized-active');
                    
                    // b) Remove this listener
                    this.removeEventListener('change', oneTimeChangeHandler);
                    
                    // c) Perform the write operation
                    updatePaymentStatus(loanNo, newStatus, this);
                });
            }, 100);

        } else {
            alert('Incorrect passcode. Status change not authorized.');
            input.value = '';
            // Restore original text on disabled element
            selectElement.querySelector('option[disabled]').textContent = `-- ${originalStatus} --`;
        }
    };
    
    submitButton.addEventListener('click', attemptAuth);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') attemptAuth();
    });
}
// --- END NEW ADVOCATE PAYMENT TRACKER LOGIC ---

// NEW FUNCTION: Show Payment Breakdown Popup (Unchanged, kept for completeness)
function showPaymentBreakdownPopup(buttonElement, advocateName) {
    const loanNo = buttonElement.getAttribute('data-loan-no');
    
    // Find the record to get the full fee details for the breakdown
    const record = ALL_RECORDS.find(r => 
        String(r["Loan No"]).trim() === loanNo && 
        (String(r["ADVOCATE"]).trim() === advocateName || String(r["Sec/9 Advocate"]).trim() === advocateName)
    );
    
    if (!record) {
        alert("Error: Could not find the corresponding loan record for breakdown.");
        return;
    }
    
    const details = getAdvocatePaymentDetails(record, advocateName);
    const netTotal = details.totalAdvocateNet;
    
    let breakdownHTML = `
        <div id="payment-breakdown-modal" class="modal-overlay">
            <div class="modal-content">
                <span class="close-button">&times;</span>
                <h3>Payment Breakdown for ${advocateName}</h3>
                <p><b>Loan No:</b> ${loanNo} | <b>Branch:</b> ${record["Loan Branch"]}</p>
                <hr>
                
                ${details.is138 ? renderSectionBreakdown(record, details.sec138Fields, "Section 138 Fees", details.sec138Net) : ''}
                
                ${details.is09 ? renderSectionBreakdown(record, details.sec09Fields, "Section 09 Fees", details.sec09Net) : ''}

                <div class="grand-total-summary">
                    <span>FINAL NET PAYMENT</span>
                    <span>${netTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })}</span>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', breakdownHTML);
    
    const modal = document.getElementById('payment-breakdown-modal');
    
    // Close modal listeners
    modal.querySelector('.close-button').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            modal.remove();
        }
    });
}

// Helper to render the detailed breakdown table for a section (Unchanged, kept for completeness)
function renderSectionBreakdown(record, fields, sectionTitle, sectionNet) {
    let tableRows = '';
    let totalFeeBeforeTDS = 0;
    let totalGST = 0;
    let totalTDS = 0;
    
    fields.forEach(field => {
        // Only include fields that have a value greater than 0
        const rawValue = record[field];
        const value = parseNumber(rawValue);
        
        if (value !== 0) {
            const isTDS = field.includes("TDS");
            const isGST = field.includes("GST");
            const isFee = !isTDS && !isGST;
            
            const sign = isTDS ? -1 : 1;
            const amount = value * sign;

            // Track totals for the summary rows
            if (isFee) {
                totalFeeBeforeTDS += value;
            } else if (isGST) {
                totalGST += value;
            } else if (isTDS) {
                // We track TDS as a positive amount for the summary, then subtract it.
                totalTDS += value; 
            }

            // Determine row class for clear visual differentiation
            let rowClass = '';
            let labelSuffix = '';
            if (isGST) {
                rowClass = 'gst-value'; 
                labelSuffix = '<span class="gst-label">(Not included in Net Payment)</span>';
            } else if (isTDS) {
                rowClass = 'minus-value';
            } else {
                rowClass = 'fee-value'; 
            }
            
            tableRows += `
                <tr class="${rowClass}">
                    <td>${field} ${labelSuffix}</td>
                    <td class="right-align">${amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })}</td>
                </tr>
            `;
        }
    });

    if (tableRows === '') return ''; // Hide section if all fields are zero
    
    // The final net calculation is: (Total Fees) - (Total TDS)
    // totalFeeBeforeTDS holds the sum of "Initial Fee" and "Final Fee"
    const calculatedNet = totalFeeBeforeTDS - totalTDS;

    const gstTotalRow = totalGST > 0 ? `
        <tr class="section-total-row gst-summary">
            <td>Total GST:</td>
            <td class="right-align">${totalGST.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })}</td>
        </tr>
    ` : '';
    
    return `
        <h4>${sectionTitle} Calculation</h4>
        <p class="calc-note">Note: Net Payment calculation uses <b>Fee - TDS</b> and <b>excludes GST</b>.</p>
        <table class="breakdown-table">
            <thead>
                <tr><th>Fee/Charge Description</th><th class="right-align">Amount</th></tr>
            </thead>
            <tbody>
                ${tableRows}
            </tbody>
            <tfoot>
                <tr class="section-total-row">
                    <td>Total Fees (Gross):</td>
                    <td class="right-align">${totalFeeBeforeTDS.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })}</td>
                </tr>
                <tr class="section-total-row">
                    <td>Total TDS Deduction:</td>
                    <td class="right-align minus-value">${(totalTDS * -1).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })}</td>
                </tr>
                ${gstTotalRow}
                <tr class="section-total-row final-net-payment">
                    <td>${sectionTitle} Net Payment (Fee - TDS):</td>
                    <td class="right-align">${sectionNet.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })}</td>
                </tr>
            </tfoot>
        </table>
    `;
}

// --- ACCORDION EVENT LISTENER LOGIC (FIXED) ---
function addAccordionListeners() {
    // Remove old listeners (if any)
    document.querySelectorAll('.data-block .accordion-header').forEach(header => {
        header.removeEventListener('click', toggleAccordion);
    });

    // Add new listeners
    document.querySelectorAll('.data-block .accordion-header').forEach(header => {
        header.addEventListener('click', toggleAccordion);
    });
}

function toggleAccordion() {
    // 'this' is the header element (.accordion-header)
    const header = this;
    const content = header.nextElementSibling; // The content wrapper is the next sibling
    
    if (content && content.classList.contains('accordion-content')) {
        const isExpanded = header.classList.contains('expanded');
        const icon = header.querySelector('.accordion-icon');
        
        if (isExpanded) {
            // Collapse
            content.classList.remove('expanded');
            header.classList.remove('expanded');
            header.classList.add('collapsed');
            icon.textContent = '▶';
        } else {
            // Expand
            content.classList.add('expanded');
            header.classList.add('expanded');
            header.classList.remove('collapsed');
            icon.textContent = '▼';
        }
    }
}
// --- END ACCORDION EVENT LISTENER LOGIC ---


// --- TOGGLE EVENT LISTENER (Unchanged) ---
document.addEventListener('DOMContentLoaded', () => {
    if (ADVOCATE_FEE_TOGGLE) {
        ADVOCATE_FEE_TOGGLE.addEventListener('change', () => {
            const isChecked = ADVOCATE_FEE_TOGGLE.checked;
            
            if (window.CURRENT_LOAN_RECORD) {
                renderFilteredBlocks(window.CURRENT_LOAN_RECORD, isChecked);
                addAccordionListeners(); // Re-add listeners after re-render
                LOADING_STATUS.textContent = isChecked ? 'Showing Advocate Fee related charges only.' : 'Showing all charges.';
            } else {
                ADVOCATE_FEE_TOGGLE.checked = false; 
                LOADING_STATUS.textContent = 'Error: No loan data loaded to filter.';
            }
        });
    }
});
// --- END TOGGLE EVENT LISTENER ---

// --- BLOCK A: ADVOCATE TRACKER STATUS LOGIC (START) ---

/**
 * Filters ALL_RECORDS to find loans associated with the selected advocate 
 * and formats the necessary payment data.
 */
function getAdvocatePaymentDetails(advocateName) {
    ADVOCATE_PAYMENTS_VIEW.innerHTML = '<p class="loading-message">Loading payments...</p>';

    const paymentRecords = ALL_RECORDS.filter(record => 
        String(record["ADVOCATE"]).trim() === advocateName || 
        String(record["Sec/9 Advocate"]).trim() === advocateName
    ).map(record => {
        // Calculate the net fee (Fee - TDS) for both Section 138 and Section 09
        let fee138Net = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_138.AdvocateFeeNetFields);
        let fee09Net = calculateAdvocateFeePaymentNet(record, CHARGE_DEFINITIONS_09.AdvocateFeeNetFields);
        let totalNetFee = fee138Net + fee09Net;

        return {
            loanNo: record["Loan No"],
            advocateFee: totalNetFee,
            fullRecord: record
        };
    }).filter(p => p.advocateFee > 0); // Only show loans with a positive net fee

    if (paymentRecords.length > 0) {
        displayAdvocatePayments(advocateName, paymentRecords);
    } else {
        ADVOCATE_PAYMENTS_VIEW.innerHTML = `<p>No active payment records found for <b>${advocateName}</b>.</p>`;
    }
}


/**
 * Renders the table view for the Advocate Payment Tracker.
 */
function displayAdvocatePayments(selectedAdvocate, loanPayments) {
    // Note: The STATUS_FIELD and STATUS_OPTIONS constants were correctly identified in your existing code.
    const STATUS_FIELD = "Advocate Payment Status"; 
    const STATUS_OPTIONS = ["Paid", "Processing", "Rejected"];

    let tableHtml = `
        <table class="advocate-tracker-table">
            <thead>
                <tr>
                    <th>Loan No</th>
                    <th>Sanction Date</th>
                    <th>Advocate Fee (Net)</th>
                    <th>${STATUS_FIELD}</th>
                    <th>Last Status Date</th>
                </tr>
            </thead>
            <tbody>
    `;

    loanPayments.forEach(payment => {
        const currentStatus = String(payment.fullRecord[STATUS_FIELD] || 'Unset').trim();
        const lastStatusDate = formatDate(payment.fullRecord["Last Status Update Date"] || 'N/A');

        const statusOptionsHtml = STATUS_OPTIONS.map(opt => 
            // The selected option will be the current value from the sheet
            `<option value="${opt}" ${opt === currentStatus ? 'selected' : ''}>${opt}</option>`
        ).join('');
        
        // CRITICAL: The dropdown is DISABLED by default. 
        const statusDropdownHtml = `
            <select class="status-dropdown" 
                    data-loan-no="${payment.loanNo}" 
                    data-original-status="${currentStatus}"
                    disabled
            >
                <option value="Unset" ${currentStatus === 'Unset' ? 'selected' : ''} disabled>-- ${currentStatus} --</option>
                ${statusOptionsHtml}
            </select>
        `;

        tableHtml += `
            <tr data-advocate="${selectedAdvocate}" data-loan-no="${payment.loanNo}">
                <td>${payment.loanNo}</td>
                <td>${formatDate(payment.fullRecord["Loandate"])}</td>
                <td>${payment.advocateFee.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })}</td>
                <td>${statusDropdownHtml}</td>
                <td>${lastStatusDate}</td>
            </tr>
        `;
    });
    
    tableHtml += `</tbody></table>`;
    ADVOCATE_PAYMENTS_VIEW.innerHTML = tableHtml;

    // Add listener to all disabled dropdowns to trigger auth (Core requirement: Click disabled -> Popup)
    document.querySelectorAll('.status-dropdown').forEach(select => {
        select.addEventListener('mousedown', function(e) {
            // Prevent the dropdown from opening immediately if disabled
            if (this.disabled) {
                e.preventDefault(); 
                showPasscodePopup(this); // <-- Triggers the modal/popup
            }
        });
    });
}


/**
 * Handles the POST request to save the new status to the backend/Google Sheet.
 */
async function updatePaymentStatus(loanNo, newStatus, selectElement) {
    const originalStatus = selectElement.getAttribute('data-original-status');
    const loadingText = `...Updating to ${newStatus}...`;
    
    // Temporarily change the disabled option's text
    const disabledOption = selectElement.querySelector('option[disabled]');
    if (disabledOption) disabledOption.textContent = loadingText;

    const dataToSend = {};
    dataToSend["Loan No"] = loanNo; 
    dataToSend[STATUS_FIELD] = newStatus; 
    dataToSend["authKey"] = CLIENT_SIDE_AUTH_KEY; 
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            mode: 'cors', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSend)
        });

        const result = await response.json();
        
        if (result.status === 'success') {
            alert(`✅ Status for Loan ${loanNo} successfully updated to ${newStatus}.`);
            
            // Reload the ALL_RECORDS data and re-render the advocate table
            // This ensures the "Last Status Update Date" column is refreshed from the server
            await initialLoad(); 
            getAdvocatePaymentDetails(ADVOCATE_TRACKER_SELECT.value);
            
        } else {
            alert(`❌ Status Update Error for Loan ${loanNo}: ${result.message}. Please try again.`);
            getAdvocatePaymentDetails(ADVOCATE_TRACKER_SELECT.value);
        }

    } catch (error) {
        alert(`❌ Network Error. Could not update status for Loan ${loanNo}.`);
        console.error("Status update error:", error);
        getAdvocatePaymentDetails(ADVOCATE_TRACKER_SELECT.value);
    }
}



function showPasscodePopup(selectElement) {
    const loanNo = selectElement.getAttribute('data-loan-no');
    
    // Check if modal already exists to prevent duplicates
    if (document.getElementById('passcode-modal')) return;

    // HTML structure for the modal - REQUIRES CSS from Block C
    const popupHTML = `
        <div id="passcode-modal" class="modal-overlay">
            <div class="modal-content small-modal">
                <span class="close-button" onclick="document.getElementById('passcode-modal').remove()">&times;</span>
                <h4>Authorize Status Change for Loan ${loanNo}</h4>
                <p>Enter the passcode (<b>123</b>) to enable the status dropdown:</p>
                <input type="password" id="status-passcode-input" placeholder="Passcode">
                <button id="passcode-submit-button">Submit</button>
                <p id="passcode-error-message" style="color: var(--color-danger); margin-top: 10px; display: none;"></p>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', popupHTML);
    const modal = document.getElementById('passcode-modal');
    const input = document.getElementById('status-passcode-input');
    const submitButton = document.getElementById('passcode-submit-button');
    const errorMessage = document.getElementById('passcode-error-message');
    const originalStatus = selectElement.getAttribute('data-original-status');
    const passcode = "123"; // The hardcoded passcode from your CLIENT_SIDE_AUTH_KEY

    setTimeout(() => input.focus(), 100);

    const closeModal = () => modal.remove();
    
    modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeModal();
        }
    });

    const attemptAuth = () => {
        const enteredKey = input.value;
        errorMessage.style.display = 'none';
        
        if (enteredKey === passcode) {
            
            // 1. SUCCESS: Enable the dropdown and visually highlight
            selectElement.disabled = false;
            selectElement.classList.add('authorized-active');
            selectElement.querySelector('option[disabled]').textContent = `-- Select New Status --`;
            
            // 2. Remove the modal
            closeModal(); 
            
            // 3. Attach ONE-TIME change listener (Fires when user selects an option)
            const oneTimeChangeHandler = function() {
                const newStatus = this.value;
                
                // a) Immediately disable the dropdown again (Core Requirement)
                this.disabled = true;
                this.classList.remove('authorized-active');
                
                // b) Remove this listener 
                this.removeEventListener('change', oneTimeChangeHandler);
                
                // c) Perform the write operation
                updatePaymentStatus(loanNo, newStatus, this);
            };

            setTimeout(() => {
                 selectElement.addEventListener('change', oneTimeChangeHandler);
            }, 10);

        } else {
            errorMessage.textContent = '❌ Incorrect passcode.';
            errorMessage.style.display = 'block';
            input.value = '';
            // Restore original text
            selectElement.querySelector('option[disabled]').textContent = `-- ${originalStatus} --`;
        }
    };
    
    submitButton.addEventListener('click', attemptAuth);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') attemptAuth();
    });
}
// --- BLOCK A: ADVOCATE TRACKER STATUS LOGIC (END) ---
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