import pdfParse from 'pdf-parse-fork'

export interface TocChapter {
  chapterNumber: number
  title: string
  pageNumber: number
}

export class TableOfContentsExtractor {
  /**
   * Extract chapters from a PDF by finding the Table of Contents page
   */
  async extractChaptersFromTOC(pdfBuffer: Buffer): Promise<TocChapter[] | null> {
    console.log('[TOC_EXTRACTOR] Starting table of contents extraction...')

    try {
      const pdfData = await pdfParse(pdfBuffer, {
        pagerender: (pageData: any) => {
          // Get text with page breaks
          return pageData.getTextContent().then((textContent: any) => {
            let text = ''
            for (const item of textContent.items) {
              text += item.str + ' '
            }
            return text + '\n\f' // Add form feed for page break
          })
        }
      })

      // Split by pages
      const pages = pdfData.text.split('\f')
      console.log(`[TOC_EXTRACTOR] Analyzing ${pages.length} pages for TOC...`)

      // Look for TOC in first 10 pages
      for (let i = 0; i < Math.min(10, pages.length); i++) {
        const pageText = pages[i]
        const lowerText = pageText.toLowerCase()

        // Check if this page contains table of contents
        if (lowerText.includes('contents') || lowerText.includes('table of contents') || lowerText.includes('index')) {
          console.log(`[TOC_EXTRACTOR] Found potential TOC on page ${i + 1}`)

          const chapters = this.parseTableOfContents(pageText)
          if (chapters.length > 0) {
            console.log(`[TOC_EXTRACTOR] Successfully extracted ${chapters.length} chapters from TOC`)
            return chapters
          }
        }
      }

      console.log('[TOC_EXTRACTOR] No table of contents found')
      return null

    } catch (error) {
      console.error('[TOC_EXTRACTOR] Error:', error)
      return null
    }
  }

  /**
   * Parse a table of contents page to extract chapter information
   */
  private parseTableOfContents(tocText: string): TocChapter[] {
    const chapters: TocChapter[] = []

    // First try splitting by newlines
    let lines = tocText.split('\n').map(line => line.trim()).filter(line => line.length > 0)

    // If we only get one line, it might be that line breaks weren't preserved
    // Try to split by chapter patterns
    if (lines.length === 1) {
      console.log('[TOC_EXTRACTOR] Single line detected, attempting to split by chapter patterns')
      const singleLine = lines[0]

      // First, try to find where each chapter entry starts
      // Look for pattern: number + dot + space (e.g., "1. ", "2. ", "10. ")
      const chapterStarts: number[] = []
      const chapterPattern = /\b(\d{1,2})\.\s+[A-Z]/g
      let match
      while ((match = chapterPattern.exec(singleLine)) !== null) {
        chapterStarts.push(match.index)
      }

      // Extract each chapter line
      if (chapterStarts.length > 0) {
        lines = []
        for (let i = 0; i < chapterStarts.length; i++) {
          const start = chapterStarts[i]
          const end = i < chapterStarts.length - 1 ? chapterStarts[i + 1] : singleLine.length
          const chapterLine = singleLine.substring(start, end).trim()
          if (chapterLine) {
            lines.push(chapterLine)
          }
        }
        console.log(`[TOC_EXTRACTOR] Split into ${lines.length} chapter lines`)
      }
    }

    console.log('[TOC_EXTRACTOR] Parsing TOC with', lines.length, 'lines')
    // Log first few lines for debugging
    lines.slice(0, 5).forEach((line, i) => {
      console.log(`[TOC_EXTRACTOR] Line ${i}: "${line.substring(0, 100)}${line.length > 100 ? '...' : ''}"`)
    })

    // Common TOC patterns:
    // "1. Chapter Title . . . . . . . 15"
    // "Chapter 1: Title ............ 15"
    // "1 Title .................... 15"
    // "Properties of Radio Waves. . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 1"

    const patterns = [
      // Pattern 1: "1. DC Electrics - Basic Principles . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 1"
      // This pattern is more flexible with spaces and dots
      /^(\d+)\.\s+(.+?)\s+\.+\s+(\d+)\s*$/,

      // Pattern 2: Handle cases where dots might be spaces
      /^(\d+)\.\s+(.+?)\s{2,}(\d+)\s*$/,

      // Pattern 3: "Chapter 1: Title ... 15"
      /^Chapter\s+(\d+)[:\s]+([^.]+?)[\s.]+(\d+)\s*$/i,

      // Pattern 4: Very flexible - just number, title, and page
      /^(\d+)\.\s+(.+?)\s+(\d+)\s*$/
    ]

    for (const line of lines) {
      // Skip lines that are too short or don't contain numbers
      if (line.length < 5 || !line.match(/\d/)) continue

      // Skip common non-chapter lines
      if (line.toLowerCase().includes('contents') ||
        line.toLowerCase().includes('index') ||
        line.toLowerCase().includes('page')) continue

      let matched = false
      for (const pattern of patterns) {
        const match = line.match(pattern)
        if (match) {
          const chapterNumber = parseInt(match[1])
          let title = match[2].trim().replace(/\.+$/, '') // Remove trailing dots
          const pageNumber = parseInt(match[3])

          // Clean up the title more aggressively
          title = title.replace(/\s*[.\s]+$/, '').trim() // Remove trailing dots and spaces

          console.log(`[TOC_EXTRACTOR] Matched line: "${line}"`)
          console.log(`[TOC_EXTRACTOR] Extracted: Chapter ${chapterNumber}, Title: "${title}", Page: ${pageNumber}`)

          // Validate the match
          if (chapterNumber > 0 && chapterNumber < 100 &&
            title.length > 2 &&
            pageNumber > 0 && pageNumber < 1000) {

            chapters.push({
              chapterNumber,
              title,
              pageNumber
            })
            matched = true
            break // Found a match, move to next line
          } else {
            console.log(`[TOC_EXTRACTOR] Match validation failed`)
          }
        }
      }
      if (!matched && line.match(/^\d+\./)) {
        console.log(`[TOC_EXTRACTOR] Failed to match chapter line: "${line}"`)
      }
    }

    // Sort by page number to ensure reading order
    chapters.sort((a, b) => a.pageNumber - b.pageNumber)

    // Re-assign chapter numbers to be strictly sequential (1, 2, 3...)
    // This fixes the "Unique constraint failed" error when PDFs have multiple "Chapter 1"s (e.g. in different sections)
    return chapters.map((ch, index) => ({
      ...ch,
      chapterNumber: index + 1
    }))
  }
}
