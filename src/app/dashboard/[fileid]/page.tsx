import ChatWrapper from '@/components/chat/ChatWrapper'
import PdfRenderer from '@/components/PdfRenderer'
import { db } from '@/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'

interface PageProps {
  params: {
    fileid: string
  }
}

const Page = async ({ params }: PageProps) => {
  const { fileid } = params

  const file = await db.file.findFirst({
    where: {
      id: fileid,
    },
  })

  if (!file) notFound()

  return (
    <div className='flex-1 justify-between flex flex-col h-[calc(100vh-3.5rem)]'>
      <div className='mx-auto w-full max-w-8xl grow lg:flex xl:px-2'>
        {/* Left sidebar & main wrapper */}
        <div className='flex-1 xl:flex'>
          <div className='px-4 py-6 sm:px-6 lg:pl-8 xl:flex-1 xl:pl-6'>
            {/* Main area */}
            <PdfRenderer url={file.url} />
          </div>
        </div>

        <div className='shrink-0 flex-[0.75] border-t border-gray-200 lg:w-96 lg:border-l lg:border-t-0'>
          {/* Analytics Button */}
          <div className="border-b border-gray-200 bg-white p-3">
            <Link
              href={`/dashboard/${fileid}/analytics`}
              className={buttonVariants({ 
                variant: 'outline', 
                className: 'w-full gap-2' 
              })}
            >
              <BarChart3 className="h-4 w-4" />
              View Analytics
            </Link>
          </div>
          
          <ChatWrapper fileId={file.id} />
        </div>
      </div>
    </div>
  )
}

export default Page
