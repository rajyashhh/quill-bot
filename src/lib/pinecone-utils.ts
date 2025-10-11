import { Pinecone } from '@pinecone-database/pinecone'

export async function ensurePineconeIndex(indexName: string) {
  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!,
  } as any)
  
  try {
    // Try to list indexes to verify connection
    const indexList = await pinecone.listIndexes()
    console.log('[PINECONE] Available indexes:', JSON.stringify(indexList, null, 2))
    
    // Check if our index exists
    const indexExists = indexList.indexes?.some(index => index.name === indexName)
    
    if (!indexExists) {
      console.error(`[PINECONE] Index '${indexName}' does not exist!`)
      console.log('[PINECONE] Please create the index with the following configuration:')
      console.log('- Name:', indexName)
      console.log('- Dimension: 1536 (for text-embedding-ada-002)')
      console.log('- Metric: cosine')
      console.log('- Cloud: AWS')
      console.log('- Region: us-east-1')
      throw new Error(`Pinecone index '${indexName}' does not exist`)
    }
    
    console.log(`[PINECONE] Index '${indexName}' found and ready`)
    return pinecone.Index(indexName)
  } catch (error) {
    console.error('[PINECONE] Error ensuring index:', error)
    throw error
  }
}
