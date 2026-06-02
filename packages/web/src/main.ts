import { mount } from 'svelte';
import Root from './Root.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Mount target #app not found');
const app = mount(Root, { target });

export default app;
