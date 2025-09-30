// **CRITICAL: Replace this with your actual deployed Apps Script Web app URL**
const API_URL = "https://script.google.com/macros/s/AKfycbzqY3jB718XUHuExG3VONTc5WmhZpumtu0hn3i5o-ba4OtnDUvsd_h9XPN5WR_sWPhwrw/exec"; 
const FORM = document.getElementById('record-form');
const TABLE_BODY = document.querySelector('#data-table tbody');
const TABLE_HEAD = document.querySelector('#data-table thead');
const MESSAGE_ELEMENT = document.getElementById('submission-message');

// --- 1. READ OPERATION (Fetch Data) ---

async function fetchData() {
    document.getElementById('loading-status').textContent = 'Fetching data...';
    try {
        const response = await fetch(API_URL, {
            method: 'GET',
            // Important for Apps Script security, though less critical for doGet
            mode: 'cors' 
        });

        const result = await response.json();

        if (result.status === 'success' && result.data.length > 0) {
            renderTable(result.data);
            document.getElementById('loading-status').textContent = `Data loaded successfully (${result.data.length} records).`;
        } else {
            document.getElementById('loading-status').textContent = 'No data found or empty sheet.';
        }

    } catch (error) {
        console.error("Error fetching data:", error);
        document.getElementById('loading-status').textContent = 'Error loading data. Check console for details.';
    }
}

function renderTable(data) {
    // 1. Clear previous content
    TABLE_HEAD.innerHTML = '';
    TABLE_BODY.innerHTML = '';

    // Data structure is guaranteed to be an Array of Objects.
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
            // Handle null/undefined data gracefully
            cell.textContent = record[header] || ''; 
            row.appendChild(cell);
        });
        TABLE_BODY.appendChild(row);
    });
}


// --- 2. WRITE OPERATION (Submit Data) ---

FORM.addEventListener('submit', async function(event) {
    event.preventDefault();
    MESSAGE_ELEMENT.textContent = 'Submitting...';

    // The data object must use keys that match the desired Google Sheet header names.
    const dataToSend = {
        // IMPORTANT: The key names here should match the desired column headers 
        // in your Google Sheet (A-AP for existing, AQ+ for new).
        "Project Name": document.getElementById('project_name').value, 
        "Date Recorded": document.getElementById('date_recorded').value,
        // If "Current Status" doesn't exist in AQ+, the Apps Script will create the column!
        "Current Status": document.getElementById('new_status').value, 
        // You can add data for A-AP columns too if needed, but it's often best 
        // to only send AQ+ data for new records.
    };

    try {
        const authKey = document.getElementById('auth-key').value;
        
        // You can add the authKey to the data payload or URL parameters for your Apps Script 
        // to check it, if you enabled a custom authorization check in doPost(e).
        // For now, we'll rely on the API URL being somewhat hidden.

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
            // Clear the form after success
            FORM.reset(); 
            // Refresh the table to show the new data immediately
            await fetchData(); 
        } else {
            MESSAGE_ELEMENT.textContent = `❌ Submission Error: ${result.message}`;
        }

    } catch (error) {
        MESSAGE_ELEMENT.textContent = '❌ Network Error. Could not connect to API.';
        console.error("Submission error:", error);
    }
});


// --- 3. Authorization/UI Toggling ---

function showInputForm() {
    const authKey = document.getElementById('auth-key').value;
    // Simple client-side check. Implement the real check in doPost() later.
    if (authKey === 'secret123') { // CHANGE 'secret123' to your actual key
        document.getElementById('record-form').style.display = 'block';
        alert('Input enabled! Please submit your data.');
    } else {
        alert('Incorrect secret key. Write access denied.');
        document.getElementById('record-form').style.display = 'none';
    }
}


// Start the process when the page loads
document.addEventListener('DOMContentLoaded', fetchData);