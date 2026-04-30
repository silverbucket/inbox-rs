import { mount } from 'svelte';
import Options from './Options.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Mount target #app not found');
const app = mount(Options, { target });

export default app;
