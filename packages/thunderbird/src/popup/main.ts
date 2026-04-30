import { mount } from 'svelte';
import Popup from './Popup.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Mount target #app not found');
mount(Popup, { target });
