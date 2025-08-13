
// You will need to set these environment variables or edit the following values


// Required Azure OpenAI deployment name and API ver

const { AzureOpenAI } = require("openai");
const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');
// Load the .env file if it exists
const dotenv = require("dotenv");
dotenv.config();
const endpoint = process.env.AZURE_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_API_KEY;

const apiVersion = "2024-08-01-preview";
const deployment = "gpt-4o"; //This must match your deployment name.


async function main() {

  const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });

      const conversation = `
    Caller: Hi, I'm looking to reduce 10 kg weight.
    AI: Sure, can you please tell me your height and weight and age?
    Caller: I'm 179 cm tall and weigh 80 kg and age 21.
    AI: are you allergic to any food and can you tell what you eat normally.
    Caller: I eat typical North Indian meals and I am allergic to oatmeal.
    `;
//     const dietPlanSchema = z.object({
//         height: z.string(),
//         weight: z.string(),
//     })
//   const result = await client.chat.completions.create({
//     messages: [
//         { role: 'system', content: 'Extract relevant health data and suggest how much calorie he should take based on the conversation. Please suggest 3 options for each meal (breakfast, mid-morning snack, lunch, afternoon snack, dinner) in JSON format so he can fulfill the recommended calorie intake, also keep in mind user specific diet needs,also give quantity in grams and give description of items with its quantity, also analyze should we send whatsapp message' },
//         { role: 'user', content: conversation },
//       ],
//     response_format: zodResponseFormat(dietPlanSchema, "structuredData"),
//     model: "",
//   });

const qualifiedLeadTypeSchema  = z.object({
    hotLead: z.number(),
    coldLead: z.number(),
    warmLead: z.number(),
    explanation: z.string(),
    whatsappMessage:z.number(),
    name: z.string(),
    detailedSummary: z.string(),
    problem: z.string()
  })
  const prompt = {True: 'if the user accecpts ', False: 'if the user rejects or is not sure'};
  const chat = '| human:  Hello कौन? | AI:  मैं भूमि हूँ, markaible से, क्या मैं आपसे 2 मिनट बात कर सकती हूँ? | human:  जी बच्चे किस बारे में बात करनी है? | AI:  Markaible में हम AI callers बनाते हैं, बिल्कुल मेरी तरह, जो आपके prospects को कॉल करके information collect कर सकते हैं, interview ले सकते हैं, WhatsApp कर सकते हैं, और भी बहुत कुछ। क्या आप हमारी इस technology में interested हैं? | human:  किस type का technology है मतलब आपका? | AI:  हमारी technology AI-based voice agents पर आधारित है, जो कॉल्स कर सकते हैं, incoming calls handle कर सकते हैं, emails भेज सकते हैं, और WhatsApp messages भी कर सकते हैं। ये पूरी तरह से scalable है, मतलब आपकी जरूरत के हिसाब से adjust हो सकती है। | human:  चाहते हैं ही बोल रहे हैं क्या? | AI:  जी हाँ, ये voice agents आपकी recruitment agency के लिए बहुत फायदेमंद हो सकते हैं। ये candidates से बात करके data collect कर सकते हैं, जिससे आपका काम आसान हो जाएगा। आप meeting book करना चाहेंगे ताकि हम details में बात कर सकें? | human:  अच्छा हां करा दीजिए. आप कौन सी company से बात कर रहे हैं | AI:  मैं Markaible से बात कर रही हूँ। मैं आपको WhatsApp पर meeting link भेज देती हूँ, ताकि आप हमारे executive से details में बात कर सकें। | human:  ठीक है, भेज दीजिए. | AI:  मैंने meeting link आपके WhatsApp पर भेज दिया है। कोई और सवाल हो तो बताइए, मैं मदद के लिए हमेशा तैयार हूँ! | human:  ठीक है, भेज दीजिए.  Ok, thank you. | AI:  आपका स्वागत है! अगर और कोई मदद चाहिए हो तो बताइए। Have a great day!'
      const response = await client.chat.completions.create({
        model: "",
        messages: [
          { role: 'system', content: `You are a world renowned data analyst known for your exceptional data analysis skills.
           Your job is to do the following task:
          1. check the OBJECTIVE to understand what the user wants
          2. look at a chat between an AI and a customer and understand the full conversation
          3. Finally, give a json of response with eight keys :
          a. explanation : explain why the given CHAT should or should not be returned to the user based on what user wants. 
          b. hotLead: Output True if the chat shows the customer is ready to make a purchase or take immediate action, and False otherwise.
          c. coldLead: Output True if the chat shows little to no interest or engagement from the customer, indicating no immediate need or purchase intent, and False otherwise.
          d. warmLead: Output True if the chat shows interest and engagement but without immediate purchase intent, indicating the customer needs more time or information, and False otherwise
          e. whatsappMessage: Output true if user has asked to send whatsapp message, and false otherwise
          f. name: Extract the customer’s name if it's present in the chat otherwise name will be an empty string.
          g  detailedSummary: "Detailed summary of the user's name, age (if mentioned), gender (if mentioned), and problem or request and response described during the conversation."
          h  problem: "Summary of the user's primary issue, request, or symptoms described.it should consists of one sentence"
          NOTE: If the conversation is too short isQualified is always False. SO make sure that there is enough conversation to tell anything.
          IMPORTANT: The chat between human and AI is divided by a pipe '|' so the human answer is for the question just before the pipe. So Isqualified will only be true if the person's positive answer is just after the question just before the answer.` },
          { role: 'user', content: `following is the CHAT between an AI and a customer and OBJECTIVE given by user:
          1. CHAT: ${chat}
          2. OBJECTIVE: ${prompt}` },
        ],
        response_format: zodResponseFormat(qualifiedLeadTypeSchema, "structuredData"),
      });
console.log(response)
 
  for (const choice of response.choices) {
    console.log(choice.message, 11);
  }
}

main().catch((err) => {
  console.error("The sample encountered an error:", err);
});

module.exports = { main };