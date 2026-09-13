import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadPDF(buffer: Buffer, filename: string): Promise<{ public_id: string; secure_url: string }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: 'nexino-uploads',
        public_id: filename,
        format: 'pdf',
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result as { public_id: string; secure_url: string });
      }
    );
    stream.end(buffer);
  });
}

export async function deletePDF(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
}

export function getSignedURL(publicId: string, expiresIn = 3600): string {
  const timestamp = Math.floor(Date.now() / 1000) + expiresIn;
  return cloudinary.url(publicId, {
    resource_type: 'raw',
    type: 'authenticated',
    secure: true,
  });
}

export default cloudinary;
