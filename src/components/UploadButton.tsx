'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from './ui/dialog'
import { Button } from './ui/button'

import Dropzone from 'react-dropzone'
import { Cloud, File, Loader2 } from 'lucide-react'
import { Progress } from './ui/progress'

import { useToast } from './ui/use-toast'
import { trpc } from '@/app/_trpc/client'
import { useRouter } from 'next/navigation'

const UploadDropzone = ({ subjectId, subfolderId }: { subjectId?: string | null, subfolderId?: string | null }) => {
  const router = useRouter()

  const [isUploading, setIsUploading] =
    useState<boolean>(false)
  const [uploadProgress, setUploadProgress] =
    useState<number>(0)
  const { toast } = useToast()

  const { mutate: startPolling } = trpc.getFile.useMutation(
    {
      onSuccess: (file) => {
        router.push(`/dashboard/${file.id}`)
      },
      retry: true,
      retryDelay: 500,
    }
  )

  const startSimulatedProgress = () => {
    setUploadProgress(0)

    const interval = setInterval(() => {
      setUploadProgress((prevProgress) => {
        if (prevProgress >= 95) {
          clearInterval(interval)
          return prevProgress
        }
        return prevProgress + 5
      })
    }, 500)

    return interval
  }

  const uploadToR2 = async (file: File) => {
    try {
      // 1. Get Presigned URL
      const authRes = await fetch('/api/upload/auth', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, fileType: file.type }),
      })
      if (!authRes.ok) throw new Error('Failed to get upload URL')
      const { signedUrl, fileKey } = await authRes.json()

      // 2. Upload to R2
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      })
      if (!uploadRes.ok) throw new Error('Failed to upload to storage')

      // 3. Complete Upload & Trigger Processing
      const completeRes = await fetch('/api/upload/complete', {
        method: 'POST',
        body: JSON.stringify({ fileKey, fileName: file.name, subjectId, subfolderId }),
      })
      if (!completeRes.ok) throw new Error('Failed to complete processing')

      return { key: fileKey }

    } catch (err: any) {
      console.error("Upload Error:", err)
      throw err
    }
  }

  return (
    <Dropzone
      multiple={false}
      maxSize={100 * 1024 * 1024} // 100MB in bytes
      accept={{
        'application/pdf': ['.pdf']
      }}
      onDrop={async (acceptedFile) => {
        setIsUploading(true)
        const progressInterval = startSimulatedProgress()

        // handle file uploading
        try {
          const file = acceptedFile[0]
          const { key } = await uploadToR2(file)

          clearInterval(progressInterval)
          setUploadProgress(100)

          startPolling({ key })
        } catch (err: any) {
          clearInterval(progressInterval)
          setIsUploading(false)
          toast({
            title: 'Upload failed',
            description: `Error: ${err.message}`,
            variant: 'destructive',
          })
        }
      }}
      onDropRejected={(rejectedFiles) => {
        const [file] = rejectedFiles
        setIsUploading(false)

        if (file.file.size > 100 * 1024 * 1024) {
          toast({
            title: 'File too large',
            description: 'Please upload a PDF file smaller than 100MB',
            variant: 'destructive',
          })
        } else {
          toast({
            title: 'Invalid file type',
            description: 'Please upload a PDF file',
            variant: 'destructive',
          })
        }
      }}>
      {({ getRootProps, getInputProps, acceptedFiles }) => (
        <div
          {...getRootProps()}
          className='border h-64 m-4 border-dashed border-gray-300 rounded-lg'>
          <div className='flex items-center justify-center h-full w-full'>
            <div
              className='flex flex-col items-center justify-center w-full h-full rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100'>
              <div className='flex flex-col items-center justify-center pt-5 pb-6'>
                <Cloud className='h-6 w-6 text-zinc-500 mb-2' />
                <p className='mb-2 text-sm text-zinc-700'>
                  <span className='font-semibold'>
                    Click to upload
                  </span>{' '}
                  or drag and drop
                </p>
                <p className='text-xs text-zinc-500'>
                  PDF (up to 100MB)
                </p>
              </div>

              {acceptedFiles && acceptedFiles[0] ? (
                <div className='max-w-xs bg-white flex items-center rounded-md overflow-hidden outline outline-[1px] outline-zinc-200 divide-x divide-zinc-200'>
                  <div className='px-3 py-2 h-full grid place-items-center'>
                    <File className='h-4 w-4 text-blue-500' />
                  </div>
                  <div className='px-3 py-2 h-full text-sm truncate'>
                    {acceptedFiles[0].name}
                  </div>
                </div>
              ) : null}

              {isUploading ? (
                <div className='w-full mt-4 max-w-xs mx-auto'>
                  <div className='h-1 w-full bg-zinc-200 rounded-full overflow-hidden'>
                    <div
                      className='h-full bg-zinc-900 transition-all duration-300 ease-in-out'
                      style={{
                        width: `${uploadProgress}%`,
                        backgroundColor: uploadProgress === 100 ? '#22c55e' : undefined // green-500
                      }}
                    />
                  </div>
                  {uploadProgress === 100 ? (
                    <div className='flex gap-1 items-center justify-center text-sm text-zinc-700 text-center pt-2'>
                      <Loader2 className='h-3 w-3 animate-spin' />
                      Redirecting...
                    </div>
                  ) : null}
                </div>
              ) : null}

              <input
                {...getInputProps()}
                type='file'
                className='hidden'
              />
            </div>
          </div>
        </div>
      )
      }
    </Dropzone >
  )
}

const UploadButton = ({ subjectId, subfolderId }: { subjectId?: string | null, subfolderId?: string | null }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false)

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(v) => {
        if (!v) {
          setIsOpen(v)
        }
      }}>
      <DialogTrigger
        onClick={() => setIsOpen(true)}
        asChild>
        <Button>Upload PDF</Button>
      </DialogTrigger>

      <DialogContent>
        <UploadDropzone subjectId={subjectId} subfolderId={subfolderId} />
      </DialogContent>
    </Dialog>
  )
}

export default UploadButton
