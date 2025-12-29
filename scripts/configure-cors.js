const { S3Client, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

async function configureCors() {
    // Hardcoded for reliable execution without dotenv/nextjs deps
    const bucketName = "pdf-uploads";
    const accountId = "2053726d00ffa5d6b03fcc9ab6118896";
    const accessKeyId = "22bddd595a63448bd3f57abdcaf18051";
    const secretAccessKey = "44502d8271c806a4ee7c6e7fcff41e3812e09c00fed9c7b42944f9ff39329a4d";

    const r2 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    });

    console.log(`Configuring CORS for bucket: ${bucketName}...`);

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
    });

    try {
        await r2.send(command);
        console.log('✅ CORS configuration applied successfully!');
    } catch (err) {
        console.error('❌ Error applying CORS configuration:', err);
    }
}

configureCors();
