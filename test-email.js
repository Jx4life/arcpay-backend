import { getMaxListeners } from 'events';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'blazebenny5@gmail.com',
    pass: 'dsqajkhtzketekby'

  }
});

transporter.sendMail({
  from: 'blazebenny5@gmail.com',
  to: '1jedxo@gmail.com',
  subject: 'Test Email',
  text: 'If you receive this, your email setup works!'
}, (error, info) => {
  if (error) {
    console.log('❌ Error:', error);
  } else {
    console.log('✅ Email sent:', info.messageId);
  }
});