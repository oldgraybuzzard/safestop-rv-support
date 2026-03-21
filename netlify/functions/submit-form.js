import { Client } from '@notionhq/client';

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_API_KEY
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Helper function to verify reCAPTCHA token
async function verifyRecaptcha(token) {
  try {
    const verifyUrl = 'https://www.google.com/recaptcha/api/siteverify';
    const secretKey = process.env.RECAPTCHA_SECRET_KEY;

    // Log verification attempt
    console.log('Attempting reCAPTCHA verification with:', {
      tokenLength: token?.length,
      hasSecretKey: !!secretKey
    });

    // Make the verification request
    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `secret=${secretKey}&response=${token}`
    });

    // Log raw response
    const rawResponse = await response.text();
    console.log('Raw reCAPTCHA response:', rawResponse);

    // Parse response
    const data = JSON.parse(rawResponse);
    console.log('Parsed reCAPTCHA response:', data);

    if (!data.success) {
      const errorCodes = data['error-codes'] || [];
      console.error('reCAPTCHA verification failed with codes:', errorCodes);
      throw new Error(`Verification failed: ${errorCodes.join(', ')}`);
    }

    return data;
  } catch (error) {
    console.error('reCAPTCHA verification error:', error);
    throw new Error(`reCAPTCHA verification failed: ${error.message}`);
  }
}

export const handler = async (event, context) => {
  console.log('Function started');
  console.log('Environment variables present:', {
    hasNotionKey: !!process.env.NOTION_API_KEY,
    hasDbId: !!process.env.NOTION_DATABASE_ID,
    hasRecaptchaKey: !!process.env.RECAPTCHA_SECRET_KEY
  });

  // Add test endpoint
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ status: 'Function is running' })
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ message: 'Method not allowed' })
    };
  }

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
      },
      body: ''
    };
  }

  try {
    // Parse the request body
    const { name, email, subject, message, recaptchaToken } = JSON.parse(event.body);

    console.log('Received form submission:', {
      name,
      email,
      subject,
      messageLength: message?.length,
      hasRecaptchaToken: !!recaptchaToken,
      tokenLength: recaptchaToken?.length
    });

    // Validate required fields
    if (!name || !email || !subject || !message) {
      console.error('Missing required fields:', { name, email, subject, messageExists: !!message });
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          message: 'Missing required fields',
          details: {
            name: !name,
            email: !email,
            subject: !subject,
            message: !message
          }
        })
      };
    }

    // Verify reCAPTCHA token
    console.log('Verifying reCAPTCHA token...');
    try {
      const recaptchaResult = await verifyRecaptcha(recaptchaToken);
      console.log('reCAPTCHA verification successful:', recaptchaResult);

      // Check score if available
      if (typeof recaptchaResult.score === 'number' && recaptchaResult.score < 0.5) {
        console.error('reCAPTCHA score too low:', recaptchaResult.score);
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            message: 'Suspicious activity detected',
            details: ['score_too_low']
          })
        };
      }
    } catch (error) {
      console.error('reCAPTCHA verification failed:', error);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          message: 'reCAPTCHA verification failed',
          error: error.message
        })
      };
    }

    // Create a new page in Notion database
    console.log('Creating Notion page with database ID:', DATABASE_ID);
    const notionPageData = {
      parent: {
        database_id: DATABASE_ID
      },
      properties: {
        "Name": {
          title: [
            {
              text: {
                content: name
              }
            }
          ]
        },
        "Email Address": {
          email: email
        },
        "Subject": {
          select: {
            name: subject
          }
        },
        "Message": {
          rich_text: [
            {
              text: {
                content: message.slice(0, 2000)
              }
            }
          ]
        },
        "Status": {
          status: {
            name: "New"
          }
        },
        "Created": {
          date: {
            start: new Date().toISOString()
          }
        }
      }
    };

    console.log('Attempting to create Notion page with data:', JSON.stringify(notionPageData, null, 2));

    try {
      const notionResponse = await notion.pages.create(notionPageData);
      console.log('Notion page created successfully:', notionResponse.id);
    } catch (error) {
      console.error('Notion API Error:', {
        message: error.message,
        code: error.code,
        body: error.body
      });
      throw error;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
      },
      body: JSON.stringify({
        message: 'Form submitted successfully',
        notionPageId: notionResponse.id
      })
    };
  } catch (error) {
    console.error('Error processing form submission:', {
      error: error.message,
      stack: error.stack,
      name: error.name
    });

    if (error.name === 'APIResponseError') {
      console.error('Notion API Error:', {
        code: error.code,
        status: error.status,
        body: error.body
      });
    }

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
      },
      body: JSON.stringify({
        message: 'Error submitting form',
        error: error.message,
        type: error.name,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
}; 