import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import './styles.css';

// 先应用主题再挂载，避免闪白
const saved = localStorage.getItem('theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');

createApp(App).use(router).mount('#app');
