import { Pinecone } from '@pinecone-database/pinecone'

// Note: When running this script directly with ts-node or tsx, 
// you may need to manually set the environment variable:
// PINECONE_API_KEY=your_key_here npx tsx src/test-pinecone.ts

async function testPineconeConnection() {
  console.log('Testing Pinecone connection...')
  
  try {
    // Initialize Pinecone client
    const apiKey = process.env.PINECONE_API_KEY || 'pcsk_4ibLQc_2oiyqhVtzByWfUjeEyTUvBT9zw6gqUtypW7XDG9b8Wt8txuBJC3Ka9FZsCcyV5e'
    console.log('API Key format:', apiKey?.substring(0, 10) + '...')
    
    const pinecone = new Pinecone({
      apiKey: apiKey,
      environment: 'us-east-1-aws', // Required by the SDK
    } as any) // Type assertion to bypass TypeScript error
    
    console.log('Pinecone client created successfully')
    
    // Try to list indexes
    try {
      const indexList = await pinecone.listIndexes()
      console.log('Successfully connected to Pinecone!')
      console.log('Available indexes:', indexList)
    } catch (listError) {
      console.error('Error listing indexes:', listError)
    }
    
    // Try to describe the specific index
    try {
      const indexName = 'quill'
      console.log(`\nTrying to access index: ${indexName}`)
      const index = pinecone.Index(indexName)
      
      // Try to describe index stats
      const stats = await index.describeIndexStats()
      console.log('Index stats:', stats)
    } catch (indexError) {
      console.error('Error accessing index:', indexError)
    }
    
  } catch (error) {
    console.error('Error initializing Pinecone:', error)
  }
}

// Run the test
testPineconeConnection()
