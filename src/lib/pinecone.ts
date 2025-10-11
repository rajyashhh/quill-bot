import { Pinecone } from '@pinecone-database/pinecone'

let pineconeClient: Pinecone | null = null

export const getPineconeClient = async () => {
  if (!pineconeClient) {
    const apiKey = process.env.PINECONE_API_KEY || 'pcsk_4ibLQc_2oiyqhVtzByWfUjeEyTUvBT9zw6gqUtypW7XDG9b8Wt8txuBJC3Ka9FZsCcyV5e'
    
    // Initialize Pinecone client with just API key (new API keys don't need environment)
    pineconeClient = new Pinecone({
      apiKey: apiKey
    })
  }
  return pineconeClient
}


