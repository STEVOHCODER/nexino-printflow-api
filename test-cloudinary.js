const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: 'fcbiwko4',
  api_key: '752462345238886',
  api_secret: '2aXIJMXXNVMBFFfkC7r8pZM_roU',
});

// Test 1: Try to make existing file public via explicit API
cloudinary.uploader.explicit(
  'nexino-uploads/nexino-1789314932383-796390772.pdf',
  { resource_type: 'raw', type: 'upload' },
  (err, result) => {
    if (err) console.log('explicit error:', err.message);
    else console.log('explicit result:', JSON.stringify({ access_mode: result?.access_mode, secure_url: result?.secure_url }));
  }
);
