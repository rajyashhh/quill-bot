import { r2 } from '@/lib/r2'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

export async function POST(req: Request) {
    try {
        const { fileName, fileType } = await req.json()

        if (!fileName || !fileType) {
            return new NextResponse('Missing required fields', { status: 400 })
        }

        const fileKey = `${uuidv4()}-${fileName.replace(/\s+/g, '-')}`

        const command = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: fileKey,
            ContentType: fileType,
        })

        const signedUrl = await getSignedUrl(r2, command, { expiresIn: 3600 })

        return NextResponse.json({ signedUrl, fileKey })
    } catch (error) {
        console.error('Error generating presigned URL:', error)
        return new NextResponse('Internal Server Error', { status: 500 })
    }
}
