import { mount } from 'svelte';
import App from './App.svelte';
import './styles.css';

const target = document.getElementById('capture-app');
if (!target) throw new Error('Mount target #capture-app not found');

mount(App, { target });
