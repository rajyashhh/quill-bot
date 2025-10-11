import { Pinecone } from '@pinecone-database/pinecone'

async function createQuillIndex() {
  console.log('Checking Pinecone index...')
  
  try {
    // Initialize Pinecone client with v6.x API
    const apiKey = process.env.PINECONE_API_KEY || 'pcsk_4ibLQc_2oiyqhVtzByWfUjeEyTUvBT9zw6gqUtypW7XDG9b8Wt8txuBJC3Ka9FZsCcyV5e'
    
    const pinecone = new Pinecone({
      apiKey: apiKey
    })
    
    console.log('Pinecone client created successfully')
    
    // Check if index already exists - v6.x returns an object with indexes array
    const indexList = await pinecone.listIndexes()
    console.log('Current indexes:', JSON.stringify(indexList, null, 2))
    
    // Check if quill index exists
    const indexExists = indexList.indexes?.some((index: any) => index.name === 'quill')
    
    if (indexExists) {
      console.log('Index "quill" already exists!')
      
      // Try to get index details
      try {
        const index = pinecone.Index('quill')
        const stats = await index.describeIndexStats()
        console.log('Index stats:', JSON.stringify(stats, null, 2))
      } catch (e) {
        console.log('Could not get index stats:', e)
      }
      return
    }
    
    console.log('\n⚠️  Index "quill" does not exist!')
    console.log('\nPlease create the index manually in the Pinecone dashboard with:')
    console.log('- Name: quill')
    console.log('- Dimension: 1536 (for OpenAI text-embedding-ada-002)')
    console.log('- Metric: cosine')
    console.log('- Cloud: AWS')
    console.log('- Region: us-east-1')
    console.log('\nNote: With the new Pinecone API keys (pcsk_*), indexes must be created via the dashboard.')
    
  } catch (error) {
    console.error('Error creating index:', error)
    if (error instanceof Error) {
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
  }
}

// Run the script
createQuillIndex()
