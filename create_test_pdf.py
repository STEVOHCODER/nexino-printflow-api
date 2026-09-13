from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import os

c = canvas.Canvas('test.pdf', pagesize=letter)
w, h = letter

c.setFont('Helvetica-Bold', 24)
c.drawCentredString(w/2, h-100, 'Nexino PrintFlow')
c.setFont('Helvetica', 14)
c.drawCentredString(w/2, h-130, 'Test Document - Page 1')
c.setFont('Helvetica', 12)
c.drawString(72, h-200, 'This is a test PDF document for Nexino PrintFlow.')
c.drawString(72, h-220, 'It simulates a real print job uploaded by a customer.')
c.drawString(72, h-240, 'Features tested:')
c.drawString(90, h-260, '- PDF upload and validation')
c.drawString(90, h-280, '- Page count detection')
c.drawString(90, h-300, '- Price calculation')
c.drawString(90, h-320, '- Job tracking')
c.showPage()

c.setFont('Helvetica-Bold', 18)
c.drawCentredString(w/2, h-100, 'Page 2')
c.setFont('Helvetica', 12)
c.drawString(72, h-150, 'This page demonstrates multi-page support.')
c.drawString(72, h-170, 'The system counts all pages for accurate pricing.')
c.showPage()

c.setFont('Helvetica-Bold', 18)
c.drawCentredString(w/2, h-100, 'Page 3')
c.setFont('Helvetica', 12)
c.drawString(72, h-150, 'Final page of the test document.')
c.showPage()

c.save()
size = os.path.getsize('test.pdf')
print(f'Created test.pdf ({size} bytes)')
