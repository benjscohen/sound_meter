// Script for the simple text pages (privacy).
import { inject } from '@vercel/analytics';

inject();
document.getElementById('year').textContent = new Date().getFullYear();
