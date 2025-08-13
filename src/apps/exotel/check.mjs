// require('dotenv').config();
import dotenv from 'dotenv';
dotenv.config();

// const { Configuration, OpenAIApi } = require('openai');
import OpenAI from 'openai';
async function testOpenAI() {
//   const configuration = new Configuration({
//     apiKey: process.env.OPENAI_API_KEY,
//   });

//   const openai = new OpenAIApi(configuration);
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY // This is also the default, can be omitted
  });

  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: "Test text",
    });

    console.log(response.data.data[0].embedding);
  } catch (error) {
    console.error('Error getting embedding:', error);
  }
}

testOpenAI();
