import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3'
import * as dotenv from 'dotenv'

dotenv.config()

async function configureCors() {
    const bucketName = process.env.R2_BUCKET_NAME
    const accountId = process.env.R2_ACCOUNT_ID
    const accessKeyId = process.env.R2_ACCESS_KEY_ID
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY

    if (!bucketName || !accountId || !accessKeyId || !secretAccessKey) {
        console.error('Error: R2 environment variables are missing.')
        process.exit(1)
    }

    const r2 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    })

    console.log(`Configuring CORS for bucket: ${bucketName}...`)

    const command = new PutBucketCorsCommand({
        Bucket: bucketName,
        CORSConfiguration: {
            CORSRules: [
                {
                    AllowedHeaders: ['*'],
                    AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD', 'DELETE'],
                    AllowedOrigins: ['http://localhost:3000', '*'],
                    ExposeHeaders: ['ETag'],
                    MaxAgeSeconds: 3600,
                },
            ],
        },
    })

    try {
        await r2.send(command)
        console.log('✅ CORS configuration applied successfully!')
    } catch (err) {
        console.error('❌ Error applying CORS configuration:', err)
    }
}

configureCors()
