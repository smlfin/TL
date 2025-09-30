// ====================================================================
// CONFIGURATION: REPLACE THESE PLACEHOLDERS
// ====================================================================

// 1. CRITICAL: Replace with your actual deployed Apps Script Web app URL
// NEW AGGRESSIVE WORKAROUND URL FORMAT
// Replace YOUR_SCRIPT_ID_HERE with the ID you copied from Project Settings.
const API_URL = "https://script.google.com/macros/s/YOUR_SCRIPT_ID_HERE/dev?alt=json";

// 2. CRITICAL: Replace with the exact key defined in Code.gs
const SECRET_WRITE_KEY = "123"; 

// ====================================================================
// DOM ELEMENTS
// ====================================================================
const FORM = document.getElementById('record-form');
const TABLE_BODY = document.querySelector('#data-table tbody');
const TABLE_HEAD = document.querySelector('#data-table thead');
const MESSAGE_ELEMENT = document.getElementById('submission-message');
const AUTH_KEY_INPUT = document.getElementById('auth-key');


// ====================================================================
// 1. READ OPERATION (Fetch Data)
// ====================================================================

async function fetchData() {
    document.getElementById('loading-status').textContent = 'Fetching data...';
    try {
        const response = await fetch(API_URL, {
            method: 'GET',
            mode: 'cors' 
        });

        const result = await response.json();

        if (result.status === 'success' && result.data) {
            if (result.data.length > 0) {
                renderTable(result.data);
                document.getElementById('loading-status').textContent = `Data loaded successfully (${result.data.length} records).`;
            } else {
                 document.getElementById('loading-status').textContent = 'Sheet is empty.';
            }
        } else {
            document.getElementById('loading-status').textContent = `API Error: ${result.message}`;
        }

    } catch (error) {
        console.error("Error fetching data:", error);
        document.getElementById('loading-status').textContent = '❌ Network Error. Could not connect to API.';
    }
}

function renderTable(data) {
    // 1. Clear previous content
    TABLE_HEAD.innerHTML = '';
    TABLE_BODY.innerHTML = '';

    // Data structure is guaranteed to be an Array of Objects from the API.
    const headers = Object.keys(data[0]);

    // 2. Render Headers
    const headerRow = document.createElement('tr');
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header;
        headerRow.appendChild(th);
    });
    TABLE_HEAD.appendChild(headerRow);

    // 3. Render Data Rows
    data.forEach(record => {
        const row = document.createElement('tr');
        headers.forEach(header => {
            const cell = document.createElement('td');
            cell.textContent = record[header] || ''; 
            row.appendChild(cell);
        });
        TABLE_BODY.appendChild(row);
    });
}


// ====================================================================
// 2. WRITE OPERATION (Submit Data & Authorization)
// ====================================================================

FORM.addEventListener('submit', async function(event) {
    event.preventDefault();
    MESSAGE_ELEMENT.textContent = 'Submitting...';

    // Collect all form data, including the secret key
    const dataToSend = {
        // Form fields defined in index.html:
        "Project Name": document.getElementById('project_name').value, 
        "Date Recorded": document.getElementById('date_recorded').value,
        "Current Status": document.getElementById('new_status').value, 
        
        // The authorization key sent to the Apps Script:
        "authKey": SECRET_WRITE_KEY // Uses the hardcoded key from the config
    };
    
    // NOTE: If you decide to let the user type the key into the UI, 
    // you would use: "authKey": AUTH_KEY_INPUT.value 
    // But keeping it hardcoded here prevents Dept B from seeing the key easily.

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
            MESSAGE_ELEMENT.textContent = '✅ Record successfully saved! Refreshing data...';
            FORM.reset(); 
            // Refresh the table to show the new data immediately
            await fetchData(); 
        } else {
            // This is where the Authorization failed message will appear if the key is wrong
            MESSAGE_ELEMENT.textContent = `❌ Submission Error: ${result.message}`; 
        }

    } catch (error) {
        MESSAGE_ELEMENT.textContent = '❌ Network Error. Could not connect to API.';
        console.error("Submission error:", error);
    }
});


// ====================================================================
// 3. UI Toggling (Simplified)
// ====================================================================

// Since the security check is now server-side, this function simply shows the form.
// For the most security, we've hardcoded the SECRET_WRITE_KEY into the script, 
// meaning Department A does NOT have to type it in the UI.
function showInputForm() {
    document.getElementById('data-input').style.display = 'block';
    // Hide the input box for the key if it's hardcoded above
    AUTH_KEY_INPUT.style.display = 'none'; 
    document.querySelector('button[onclick="showInputForm()"]').style.display = 'none';
    alert('Write access enabled.');
}


// Start the process when the page loads
document.addEventListener('DOMContentLoaded', fetchData);