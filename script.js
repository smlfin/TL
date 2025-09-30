// ====================================================================
// CONFIGURATION: REPLACE THESE PLACEHOLDERS
// ====================================================================

// API URL now points to the Netlify Function proxy
const API_URL = "/.netlify/functions/fetch-data"; 

// The secret key is now ONLY for the client-side check to enable the form.
// The real security check happens on the Google Apps Script server.
const CLIENT_SIDE_AUTH_KEY = "123"; 

// We DO NOT define SECRET_WRITE_KEY here anymore.
// We'll rely on the value entered by the user.

// ====================================================================
// DOM ELEMENTS
// ====================================================================
const FORM = document.getElementById('record-form');
const TABLE_BODY = document.querySelector('#data-table tbody');
const TABLE_HEAD = document.querySelector('#data-table thead');
const MESSAGE_ELEMENT = document.getElementById('submission-message');
const AUTH_KEY_INPUT = document.getElementById('auth-key');
const AUTH_BUTTON = document.querySelector('button[onclick="showInputForm()"]');
const AUTH_LABEL = document.querySelector('label[for="auth-key"]');


// ====================================================================
// 1. READ OPERATION (Fetch Data) - (Logic remains the same)
// ====================================================================

async function fetchData() {
    document.getElementById('loading-status').textContent = 'Fetching data...';
    try {
        // Fetching data via the Netlify Function proxy
        const response = await fetch(API_URL, {
            method: 'GET',
            mode: 'cors' 
        });

        const result = await response.json();

        // Check for success status returned by the Apps Script via Netlify
        if (result.status === 'success' && result.data) {
            if (result.data.length > 0) {
                renderTable(result.data);
                document.getElementById('loading-status').textContent = `Data loaded successfully (${result.data.length} records).`;
            } else {
                 document.getElementById('loading-status').textContent = 'Sheet is empty.';
            }
        } else {
            // Display error message from the API/Netlify function
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
// 3. UI Toggling & Client-Side Authorization Check (UPDATED)
// ====================================================================

function showInputForm() {
    const enteredKey = AUTH_KEY_INPUT.value;
    
    // Client-side key check for better user experience
    if (enteredKey === CLIENT_SIDE_AUTH_KEY) {
        // 1. If key is correct, show the data form and hide controls
        FORM.style.display = 'block';
        AUTH_KEY_INPUT.style.display = 'none';
        AUTH_BUTTON.style.display = 'none';
        AUTH_LABEL.textContent = 'Write Access Granted.';
        alert('Write access enabled! Please fill out the form.');
    } else {
        // 2. If key is incorrect, deny access
        alert('Authorization failed. Please enter the correct secret key.');
        AUTH_KEY_INPUT.value = '';
    }
}


// ====================================================================
// 2. WRITE OPERATION (Submit Data & Authorization) - (UPDATED)
// ====================================================================

FORM.addEventListener('submit', async function(event) {
    event.preventDefault();
    MESSAGE_ELEMENT.textContent = 'Submitting...';

    // CRITICAL: Get the submitted key from the input field
    const keyToSubmit = AUTH_KEY_INPUT.value;
    
    if (!keyToSubmit) {
        MESSAGE_ELEMENT.textContent = '❌ Error: Key missing from payload. Please refresh.';
        return;
    }

    // Collect all form data, including the secret key
    const dataToSend = {
        // Form fields defined in index.html:
        "Project Name": document.getElementById('project_name').value, 
        "Date Recorded": document.getElementById('date_recorded').value,
        "Current Status": document.getElementById('new_status').value, 
        
        // The authorization key sent to the Apps Script (the server performs the REAL check)
        "authKey": keyToSubmit 
    };

    try {
        // Submit data via the Netlify Function proxy
        const response = await fetch(API_URL, {
            method: 'POST',
            mode: 'cors', // Still needed for browser safety, even though server handles cross-origin
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
            // This displays the rejection message from the Apps Script server (e.g., 'Authorization failed...')
            MESSAGE_ELEMENT.textContent = `❌ Submission Error: ${result.message}`; 
        }

    } catch (error) {
        MESSAGE_ELEMENT.textContent = '❌ Network Error. Could not connect to API.';
        console.error("Submission error:", error);
    }
});


// Start the process when the page loads
document.addEventListener('DOMContentLoaded', fetchData);