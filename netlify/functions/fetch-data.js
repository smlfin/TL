// netlify/functions/fetch-data.js
const fetch = require('node-fetch');

// ⚠️ CRITICAL: Replace the URL below with YOUR actual, latest Apps Script /exec URL
const GOOGLE_API_URL = "https://script.google.com/macros/s/AKfycbzZKXnWtITdUJRy5UsDBSlWVCnSBs-FrQm7nJfxW_mb6i0-SnXSQJxCJeNcEThD3wN3ew/exec"; 

exports.handler = async function(event, context) {
    // 1. Differentiate Request Type
    const method = event.httpMethod;
    
    // Retrieve the secret key from Netlify Environment Variables
    const authKey = process.env.SECRET_WRITE_KEY; 

    // 🛑 DEBUGGING STEP: Log the key status (for testing)
    console.log("DEBUG: Key Retrieved:", authKey ? "Key Found" : "Key MISSING! (CRITICAL ERROR)");

    // --- GET REQUEST: READ OPERATION ---
    if (method === 'GET') {
        try {
            const response = await fetch(GOOGLE_API_URL, { method: 'GET' });
            if (!response.ok) {
                return { statusCode: response.status, body: JSON.stringify({ error: `Google API returned status ${response.status}` }) };
            }
            const data = await response.json();
            return {
                statusCode: 200,
                headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            };
        } catch (error) {
            return { statusCode: 500, body: JSON.stringify({ error: `Fetch Error: ${error.message}` }) };
        }

    // --- POST REQUEST: WRITE/UPDATE OPERATION (The Fix) ---
    } else if (method === 'POST') {
        try {
            // 2. Parse the payload sent from the frontend
            let payload = JSON.parse(event.body);

            // 3. Add the required authKey from Netlify's secure environment
            payload.authKey = authKey; 

            // 🛑 DEBUGGING STEP: Log the final payload (for testing)
            console.log("DEBUG: Final Payload sent to GS:", JSON.stringify(payload));
            
            // 4. Forward the POST request to Google Apps Script
            const response = await fetch(GOOGLE_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            return {
                statusCode: 200,
                headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                body: JSON.stringify(result),
            };

        } catch (error) {
            console.error("Error processing POST request:", error);
            return { 
                statusCode: 500, 
                body: JSON.stringify({ status: 'error', message: `Server Error: Failed to process POST request.` }) 
            };
        }
    }
    
    // Fallback for any other method
    return { statusCode: 405, body: JSON.stringify({ status: 'error', message: 'Method Not Allowed.' }) };
};