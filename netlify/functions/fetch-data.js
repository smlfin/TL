// netlify/functions/fetch-data.js
const fetch = require('node-fetch');

// CRITICAL: Replace this with your original working Apps Script /exec URL
const GOOGLE_API_URL = "https://script.google.com/macros/s/AKfycbyHEWn2qRcX3UmcnORjc9UmvaL4gz2lZmCFLKjn7c1mpDwuyXs3eoRuT6pGZ5jC7vPO/exec"; 

exports.handler = async function(event, context) {
    // This function acts as a proxy, fetching data from Google's server
    // and passing it back to the browser without a CORS issue.

    try {
        const response = await fetch(GOOGLE_API_URL, {
            method: 'GET',
            // Server-side request; CORS headers are ignored by Google.
        });

        // Check if the Apps Script returned a successful response
        if (!response.ok) {
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: `Google API returned status ${response.status}` }),
            };
        }
        
        const data = await response.json();

        // Return the data directly to the frontend
        return {
            statusCode: 200,
            headers: {
                // Ensure YOUR Netlify server returns the necessary CORS header (though usually implicit)
                'Access-Control-Allow-Origin': '*', 
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        };
        
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to fetch data via Netlify function.', details: error.message }),
        };
    }
};