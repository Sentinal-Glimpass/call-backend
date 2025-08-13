require('dotenv').config();
const OpenAI = require('openai');
const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
const twilio = require('twilio');
const axios = require('axios');
const base64 = require('base-64');

const exotel_auth_key = process.env.EXOTEL_AUTH_KEY;
const exotel_auth_token = process.env.EXOTEL_AUTH_TOKEN;
const exotel_account_sid = process.env.EXOTEL_ACCOUNT_SID;
const wati_token = process.env.WATI_ACESS_TOKEN
// Twilio credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

const fromWhatsAppNumber = 'whatsapp:+14155238886';
const toWhatsAppNumber = 'whatsapp:+919653088918';

const storage = new Storage();
// Google Cloud Storage setup
// const storage = new Storage({
//   projectId: "charming-opus-432422-f2",
//   keyFilename: "C:/Users/PIYUSH/Downloads/charming-opus-432422-f2-921287008763.json" // Use forward slashes
// });

const bucketName = 'liftai_bucket';

// OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const dietPlanSchema = z.object({
  height: z.string(),
  weight: z.string(),
  goal: z.string(),
  age: z.number(),
  diet: z.object({
    breakfast: z.array(z.object({
      food: z.string(),
      cal: z.string(),
      quantity: z.object({
        item1: z.string(),
        item2: z.string()
      }),
    })),
    mid_morning_snack: z.array(z.object({
      food: z.string(),
      cal: z.string(),
      quantity: z.object({
        item1: z.string(),
        item2: z.string().optional(),
      }),
    })),
    lunch: z.array(z.object({
      food: z.string(),
      cal: z.string(),
      quantity: z.object({
        item1: z.string(),
        item2: z.string().optional(),
      }),
    })),
    afternoon_snack: z.array(z.object({
      food: z.string(),
      cal: z.string(),
      quantity: z.object({
        item1: z.string(),
        item2: z.string().optional(),
      }),
    })),
    dinner: z.array(z.object({
      food: z.string(),
      cal: z.string(),
      quantity: z.object({
        item1: z.string(),
        item2: z.string().optional(),
      }),
    })),
  }),
  whatsappMessage: z.number(),
  recommended_caloric_intake: z.string(),
});

async function analyzeChat(conversation) {
  try {
    const response = await openai.beta.chat.completions.parse({
      model: 'gpt-4o-2024-08-06',
      messages: [
        { role: 'system', content: 'Extract relevant health data and suggest how much calorie he should take based on the conversation. Please suggest 3 options for each meal (breakfast, mid-morning snack, lunch, afternoon snack, dinner) in JSON format so he can fulfill the recommended calorie intake, also keep in mind user specific diet needs,also give quantity in grams and give description of items with its quantity, also analyze should we send whatsapp message' },
        { role: 'user', content: conversation },
      ],
      response_format: zodResponseFormat(dietPlanSchema, "structuredData"),
    });

    const structuredData = response.choices[0].message;

    return structuredData.parsed;
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to analyze chat and parse structured data.');
  }
}

async function createPDF(data) {
    const filePath = path.join(__dirname, 'DietPlanNew.pdf');
  
    const doc = new PDFDocument();
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);
  
    doc.fontSize(20).text('Diet Plan', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`Height: ${data.height}`);
    doc.text(`Weight: ${data.weight}`);
    doc.text(`Goal: ${data.goal}`);
    doc.text(`Age: ${data.age}`);
    doc.text(`Recommended Caloric Intake: ${data.recommended_caloric_intake}`);
    doc.moveDown();
  
    function addMealSection(title, meals) {
      doc.fontSize(16).text(title, { underline: true });
      meals.forEach(meal => {
        doc.fontSize(14).text(`Food: ${meal.food}`);
        doc.text(`Calories: ${meal.cal}`);
        doc.text(
          `Quantity: ${meal.quantity.item1}${
            meal.quantity.item2 ? `, ${meal.quantity.item2}` : ''
          }`
        );
        doc.moveDown();
      });
    }
  
    addMealSection('Breakfast', data.diet.breakfast);
    addMealSection('Mid-Morning Snack', data.diet.mid_morning_snack);
    addMealSection('Lunch', data.diet.lunch);
    addMealSection('Afternoon Snack', data.diet.afternoon_snack);
    addMealSection('Dinner', data.diet.dinner);
  
    doc.end();
    console.log('PDF generation completed.');
  
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    console.log('PDF file has been fully written to disk.');

    await storage.bucket(bucketName).upload(filePath, {
      destination: path.basename(filePath),
      contentType: 'application/pdf',
    });

    console.log('PDF uploaded to Google Cloud Storage.');
  
    const [signedUrl] = await storage.bucket(bucketName)
    .file(path.basename(filePath))
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 1000 * 60 * 60, // 1 hour expiration
    });

  
    fs.unlinkSync(filePath);
  
    return signedUrl;
}


async function sendPdfToWhatsApp(publicUrl) {
    try {
      const message = await client.messages.create({
        from: fromWhatsAppNumber,
        to: toWhatsAppNumber,
        body: 'Here is your diet plan PDF.',
        mediaUrl: publicUrl,
      });
      console.log('Message sent with SID:', message.sid);
    } catch (error) {
      console.error('Failed to send WhatsApp message:', error);
    }
}


async function createDietPdf(conversation, phone_no = 0) {
    try {
      const analyzedData = await analyzeChat(conversation);
      if(analyzedData.whatsappMessage == 0){
        console.log('User has asked not to send whatsapp message');
        return {status: 200, message: " User has asked not to send whatsapp message"}; 
      }
      const pdfUrl = await createPDF(analyzedData);
      await sendMessageViaExotel(pdfUrl, phone_no); // Sends the PDF to WhatsApp after the URL is ready
      console.log('PDF sent via WhatsApp successfully!');
      return {status: 200, message: " PDF sent via whatsapp sucessfully"};
    } catch (error) {
      console.error('Error creating diet PDF:', error);
    }
}

//   async function main() {
//     const conversation = `
//     Caller: Hi, I'm looking to reduce 10 kg weight.
//     AI: Sure, can you please tell me your height and weight and age?
//     Caller: I'm 179 cm tall and weigh 80 kg and age 21.
//     AI: are you allergic to any food and can you tell what you eat normally.
//     Caller: I eat typical North Indian meals and I am allergic to oatmeal.
//     `;
  
//     try {
//       const pdfUrl = await createDietPdf(conversation); // Waits for the PDF URL to be generated
//       await sendPdfToWhatsApp(pdfUrl); // Sends the PDF to WhatsApp after the URL is ready
//       console.log('PDF sent via WhatsApp successfully!');
//     } catch (error) {
//       console.error('Error in processing PDF and sending via WhatsApp:', error);
//     }
//   }
//   main();


async function sendMessageViaExotel(publicUrl, phone_no) {
    console.log('here is your', publicUrl, phone_no);
    const authStr = `${exotel_auth_key}:${exotel_auth_token}`;
    const authB64 = base64.encode(authStr);

    const url = `https://api.exotel.com/v2/accounts/${exotel_account_sid}/messages`;
    const data = {
        "status_callback": "https://test.requestcatcher.com/test",
        "whatsapp": {
            "messages": [
                {
                    "from": "917314626886",
                    "to": phone_no,
                    "content": {
                        "type": "template",
                        "template": {
                            "name": "test",
                            "language": {
                                "policy": "deterministic",
                                "code": "en_US"
                            },
                            "components": [
                                {
                                    "type": "header",
                                    "parameters": [
                                        {
                                            "type": "document",
                                            "document": {
                                                "link": publicUrl,
                                                "filename": "Blank"
                                            }
                                        }
                                    ]
                                },
                                {
                                    "type": "body",
                                    "parameters": [
                                        {
                                            "type": "text",
                                            "text": "take it one step at a time, and remember, I’m cheering you on every bite of the way!"
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                }
            ]
        }
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                'Authorization': `Basic ${authB64}`,
                'Content-Type': 'application/json',
            },
        });
        console.log('Message sent:', JSON.stringify(response.data));
    } catch (error) {
        console.error('Error sending message:', error.response ? error.response.data : error.message);
    }
}



async function sendWATITemplateMessage(phone_no) {
  const url =`https://live-mt-server.wati.io/353429/api/v1/sendTemplateMessage?whatsappNumber=${phone_no}`;
  const token = wati_token

  const data = {
    template_name: 'cal_mark',
    broadcast_name: 'string',
    parameters: [
      {
        name: 'string',
        value: 'string'
      }
    ]
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        'accept': '*/*',
        'Authorization': token,
        'Content-Type': 'application/json-patch+json'
      }
    });
    console.log('Message sent:', response.data);
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
  }
}



module.exports = {createDietPdf, analyzeChat, sendWATITemplateMessage}
