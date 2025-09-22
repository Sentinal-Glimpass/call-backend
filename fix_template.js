const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = 'mongodb+srv://demo:demo123@cluster0.fcoyc.mongodb.net/glimpass?retryWrites=true&w=majority&appName=Cluster0';

async function fixTemplate() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db('glimpass');

    // Update the existing template to add the {content} variable to body_text
    const result = await db.collection('emailTemplates').updateOne(
      {
        _id: new ObjectId('68cea33f34f1870cc0950af3'),
        client_id: '688d42040633f48913672d43'
      },
      {
        $set: {
          body_text: '{content}',
          updated_at: new Date()
        }
      }
    );

    if (result.matchedCount > 0) {
      console.log('✅ Template updated successfully');
      console.log(`   Matched: ${result.matchedCount} documents`);
      console.log(`   Modified: ${result.modifiedCount} documents`);
    } else {
      console.log('❌ No template found to update');
    }

    // Verify the update
    const updatedTemplate = await db.collection('emailTemplates').findOne({
      _id: new ObjectId('68cea33f34f1870cc0950af3')
    });

    if (updatedTemplate) {
      console.log('📋 Updated template:');
      console.log(`   Subject: "${updatedTemplate.subject}"`);
      console.log(`   Body Text: "${updatedTemplate.body_text}"`);
      console.log(`   Body HTML: "${updatedTemplate.body_html}"`);
    }

  } catch (error) {
    console.error('❌ Error updating template:', error);
  } finally {
    await client.close();
    console.log('🔒 MongoDB connection closed');
  }
}

fixTemplate();