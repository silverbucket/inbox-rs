import { mount } from 'svelte';
import Options from './Options.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Mount target #app not found');
mount(Options, { target });
