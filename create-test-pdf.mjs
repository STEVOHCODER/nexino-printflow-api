import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

async function createTestPdf() {
  const doc = await PDFDocument.create();
  
  const page1 = doc.addPage([612, 792]);
  page1.drawText('Nexino PrintFlow', { x: 180, y: 700, size: 24 });
  page1.drawText('Test Document - Page 1', { x: 200, y: 660, size: 14 });
  page1.drawText('This is a test PDF for Nexino PrintFlow.', { x: 72, y: 600, size: 12 });
  page1.drawText('Features: upload, validation, pricing, job tracking.', { x: 72, y: 580, size: 12 });

  const page2 = doc.addPage([612, 792]);
  page2.drawText('Page 2', { x: 260, y: 700, size: 18 });
  page2.drawText('Multi-page support for print jobs.', { x: 72, y: 650, size: 12 });

  const page3 = doc.addPage([612, 792]);
  page3.drawText('Page 3', { x: 260, y: 700, size: 18 });
  page3.drawText('Final page of test document.', { x: 72, y: 650, size: 12 });

  const pdfBytes = await doc.save();
  fs.writeFileSync('test.pdf', pdfBytes);
  console.log(`Created test.pdf (${pdfBytes.length} bytes)`);
}

createTestPdf().catch(console.error);
