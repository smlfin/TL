// Function to handle the POST request for writing data
function doPost(e) {
  const SPREADSHEET_ID = "1lhoLm2dmePsc_7ZHexVOsALrCXM-2l5BBbFZ54jrSVc";
  const SHEET_NAME = "Sheet1";
  
  // Set CORS headers for the response
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*', // Allows all origins (safest for internal use)
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  try {
    // 1. Parse the incoming JSON data
    // Use getContents() for raw data from external fetch
    const requestData = JSON.parse(e.postData.contents);
    
    // 2. Authentication (Optional, but highly recommended)
    // if (requestData.authKey !== "YOUR_SECRET_KEY") { 
    //    return createJsonResponse({ status: 'error', message: 'Unauthorized key.' }, 401, CORS_HEADERS); 
    // }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    
    // Get ALL existing headers (Row 1)
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    const incomingFields = Object.keys(requestData);
    const dataToWrite = [];
    let currentHeaders = [...headers];

    // 3. Dynamic Column and Data Mapping (Same as before)
    for (const field of incomingFields) {
      if (!currentHeaders.includes(field)) {
        // New field found! Add it as a new column header.
        const newColumnIndex = currentHeaders.length + 1;
        sheet.getRange(1, newColumnIndex).setValue(field);
        currentHeaders.push(field); 
      }
    }
    
    // 4. Prepare the Row Data based on FINAL headers
    for (let i = 0; i < currentHeaders.length; i++) {
        const header = currentHeaders[i];
        // Ensure you don't write the authKey if it's sent
        if (header !== 'authKey') {
            const value = requestData[header] !== undefined ? requestData[header] : "";
            dataToWrite.push(value);
        }
    }
    
    // 5. Append the new row
    sheet.appendRow(dataToWrite);

    // Return success response with CORS headers
    return createJsonResponse({ status: 'success', message: 'Data recorded and columns updated.', record: requestData }, 200, CORS_HEADERS);

  } catch (error) {
    Logger.log("POST Error: " + error.toString());
    // Return error response with CORS headers
    return createJsonResponse({ status: 'error', message: error.toString() }, 500, CORS_HEADERS);
  }
}


// --- NEW UTILITY FUNCTIONS ---

// 1. Function to handle the CORS pre-flight request
// This is essential for external POST requests
function doOptions(e) {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  return ContentService.createTextOutput('')
      .setHeaders(CORS_HEADERS);
}

// 2. Helper to create a JSON response with proper headers
function createJsonResponse(data, status, headers) {
  const output = ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  
  // Apply headers
  for (const header in headers) {
    output.setHeaders({[header]: headers[header]});
  }
  
  // Note: Apps Script doesn't directly set HTTP status code, 
  // but setting the headers is enough for CORS success.
  return output;
}

// NOTE: Your doGet(e) function should also be modified to use the createJsonResponse
// and include the CORS headers for consistency, although GET requests are often 
// less strict about CORS than POST requests.