import { getPineconeClient } from './pinecone'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { ChapterExtractor, ChapterInfo, TopicInfo } from './chapter-extractor'
import { TableOfContentsExtractor, TocChapter } from './toc-extractor'

interface ChapterAwareVector {
  id: string
  values: number[]
  metadata: {
    text: string
    fileId: string
    chapterNumber: number
    chapterTitle: string
    topicNumber?: number
    topicTitle?: string
    pageNumber: number
    isChapterStart?: boolean
    isTopicStart?: boolean
  }
}

export class ChapterAwarePineconeIndexer {
  private embeddings: OpenAIEmbeddings

  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    })
  }

  /**
   * Index PDF content with chapter awareness
   */
  async indexPDFWithChapters(
    fileId: string, 
    pdfBuffer: Buffer,
    chunkSize: number = 500,
    chunkOverlap: number = 100
  ) {
    console.log('[CHAPTER_AWARE_INDEXER] Starting chapter-aware indexing...')
    
    // First try to extract chapters from TOC
    const tocExtractor = new TableOfContentsExtractor()
    const tocChapters = await tocExtractor.extractChaptersFromTOC(pdfBuffer)
    
    let chapters: ChapterInfo[]
    let fullText: string
    
    if (tocChapters && tocChapters.length > 0) {
      console.log(`[CHAPTER_AWARE_INDEXER] Using ${tocChapters.length} chapters from TOC`)
      // Just extract the full text, not chapters
      const extractor = new ChapterExtractor()
      fullText = await extractor.extractFullText(pdfBuffer)
      
      // Map TOC chapters to actual content
      chapters = tocChapters.map(tocChapter => ({
        chapterNumber: tocChapter.chapterNumber,
        title: tocChapter.title.replace(/\s*\.+\s*$/, ''), // Clean up trailing dots
        startPage: tocChapter.pageNumber,
        endPage: tocChapter.pageNumber + 10, // Estimate, will be refined
        startIndex: 0, // Will be calculated
        endIndex: 0   // Will be calculated
      }))
    } else {
      console.log('[CHAPTER_AWARE_INDEXER] No TOC found, falling back to pattern detection')
      // Fall back to original chapter extraction
      const extractor = new ChapterExtractor()
      const result = await extractor.extractChaptersFromPDF(pdfBuffer)
      chapters = result.chapters
      fullText = result.fullText
    }
    
    // If no chapters found at all, return empty
    if (chapters.length === 0) {
      console.log('[CHAPTER_AWARE_INDEXER] No chapters found, skipping chapter-aware indexing')
      return { chapters: [], vectors: 0 }
    }
    
    // Get Pinecone client
    const pinecone = await getPineconeClient()
    const pineconeIndex = pinecone.Index('quill')
    
    const vectors: ChapterAwareVector[] = []
    
    // When using TOC chapters, we'll chunk the entire text and assign chapters based on context
    if (chapters.length > 0 && chapters[0].startIndex === 0 && chapters[0].endIndex === 0) {
      console.log('[CHAPTER_AWARE_INDEXER] Using simplified chunking for TOC-based chapters')
      
      // Add chapter markers
      for (const chapter of chapters) {
        vectors.push(await this.createChapterVector(
          fileId,
          chapter,
          `Chapter ${chapter.chapterNumber}: ${chapter.title}`,
          true
        ))
      }
      
      // Chunk the entire text
      const chunks = this.chunkText(fullText, chunkSize, chunkOverlap)
      console.log(`[CHAPTER_AWARE_INDEXER] Created ${chunks.length} chunks from full text`)
      
      // For each chunk, determine which chapter it belongs to based on content
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const embedding = await this.embeddings.embedQuery(chunk)
        
        // Simple assignment: divide chunks evenly among chapters
        const chapterIndex = Math.floor(i / (chunks.length / chapters.length))
        const chapter = chapters[Math.min(chapterIndex, chapters.length - 1)]
        
        vectors.push({
          id: `${fileId}-ch${chapter.chapterNumber}-chunk${i}`,
          values: embedding,
          metadata: {
            text: chunk,
            fileId,
            chapterNumber: chapter.chapterNumber,
            chapterTitle: chapter.title,
            pageNumber: chapter.startPage,
            isChapterStart: false,
            isTopicStart: false
          }
        })
      }
    } else {
      // Original logic for pattern-based chapters
      const extractor = new ChapterExtractor()
      for (const chapter of chapters) {
        const chapterContent = extractor.extractChapterContent(fullText, chapter)
        const topics = extractor.identifyTopics(chapterContent)
      
      // Add chapter start marker
      vectors.push(await this.createChapterVector(
        fileId,
        chapter,
        `Chapter ${chapter.chapterNumber}: ${chapter.title}`,
        true
      ))
      
        // Process each topic
        for (const topic of topics) {
          // Add topic start marker
          vectors.push(await this.createTopicVector(
            fileId,
            chapter,
            topic,
            `Topic ${topic.topicNumber}: ${topic.title}`,
            true
          ))
          
          // Chunk topic content
          const chunks = this.chunkText(topic.content, chunkSize, chunkOverlap)
          
          for (let i = 0; i < chunks.length; i++) {
            const embedding = await this.embeddings.embedQuery(chunks[i])
            
            vectors.push({
              id: `${fileId}-ch${chapter.chapterNumber}-t${topic.topicNumber}-chunk${i}`,
              values: embedding,
              metadata: {
                text: chunks[i],
                fileId,
                chapterNumber: chapter.chapterNumber,
                chapterTitle: chapter.title,
                topicNumber: topic.topicNumber,
                topicTitle: topic.title,
                pageNumber: chapter.startPage + Math.floor((topic.topicNumber - 1) * 
                  (chapter.endPage - chapter.startPage) / topics.length),
                isChapterStart: false,
                isTopicStart: false
              }
            })
          }
        }
      }
    }
    
    // Upsert vectors in batches
    console.log(`[CHAPTER_AWARE_INDEXER] Upserting ${vectors.length} vectors...`)
    const batchSize = 100
    
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize)
      await pineconeIndex.namespace(fileId).upsert(batch)
      console.log(`[CHAPTER_AWARE_INDEXER] Upserted batch ${i / batchSize + 1}`)
    }
    
    console.log('[CHAPTER_AWARE_INDEXER] Indexing complete!')
    return { chapters, vectors: vectors.length }
  }

  /**
   * Query for content within a specific chapter
   */
  async queryChapterContent(
    fileId: string,
    query: string,
    chapterNumber: number,
    topK: number = 5
  ) {
    const pinecone = await getPineconeClient()
    const pineconeIndex = pinecone.Index('quill')
    
    const queryEmbedding = await this.embeddings.embedQuery(query)
    
    const response = await pineconeIndex
      .namespace(fileId)
      .query({
        vector: queryEmbedding,
        topK,
        includeMetadata: true,
        filter: {
          chapterNumber: { $eq: chapterNumber }
        }
      })
    
    return response.matches || []
  }

  /**
   * Get all content for a specific topic
   */
  async getTopicContent(
    fileId: string,
    chapterNumber: number,
    topicNumber: number
  ) {
    const pinecone = await getPineconeClient()
    const pineconeIndex = pinecone.Index('quill')
    
    // Create a dummy query to get all chunks
    const dummyEmbedding = new Array(1536).fill(0)
    
    const response = await pineconeIndex
      .namespace(fileId)
      .query({
        vector: dummyEmbedding,
        topK: 100,
        includeMetadata: true,
        filter: {
          $and: [
            { chapterNumber: { $eq: chapterNumber } },
            { topicNumber: { $eq: topicNumber } }
          ]
        }
      })
    
    // Sort by chunk ID to maintain order
    const sortedMatches = (response.matches || []).sort((a, b) => {
      const aChunk = parseInt(a.id.split('-chunk')[1] || '0')
      const bChunk = parseInt(b.id.split('-chunk')[1] || '0')
      return aChunk - bChunk
    })
    
    // Combine text
    return sortedMatches
      .map(match => match.metadata?.text || '')
      .join(' ')
  }

  /**
   * Chunk text into smaller pieces
   */
  private chunkText(text: string, chunkSize: number, chunkOverlap: number): string[] {
    const chunks: string[] = []
    let start = 0
    
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length)
      chunks.push(text.substring(start, end))
      start = end - chunkOverlap
      
      // Avoid infinite loop
      if (start >= text.length - chunkOverlap) break
    }
    
    return chunks
  }

  /**
   * Create a vector for chapter marker
   */
  private async createChapterVector(
    fileId: string,
    chapter: ChapterInfo,
    text: string,
    isStart: boolean
  ): Promise<ChapterAwareVector> {
    const embedding = await this.embeddings.embedQuery(text)
    
    return {
      id: `${fileId}-ch${chapter.chapterNumber}-${isStart ? 'start' : 'marker'}`,
      values: embedding,
      metadata: {
        text,
        fileId,
        chapterNumber: chapter.chapterNumber,
        chapterTitle: chapter.title,
        pageNumber: chapter.startPage,
        isChapterStart: isStart
      }
    }
  }

  /**
   * Create a vector for topic marker
   */
  private async createTopicVector(
    fileId: string,
    chapter: ChapterInfo,
    topic: TopicInfo,
    text: string,
    isStart: boolean
  ): Promise<ChapterAwareVector> {
    const embedding = await this.embeddings.embedQuery(text)
    
    return {
      id: `${fileId}-ch${chapter.chapterNumber}-t${topic.topicNumber}-${isStart ? 'start' : 'marker'}`,
      values: embedding,
      metadata: {
        text,
        fileId,
        chapterNumber: chapter.chapterNumber,
        chapterTitle: chapter.title,
        topicNumber: topic.topicNumber,
        topicTitle: topic.title,
        pageNumber: chapter.startPage,
        isChapterStart: false,
        isTopicStart: isStart
      }
    }
  }

}
