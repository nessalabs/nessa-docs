import {afterEach, describe, expect, it, vi} from 'vitest';
import {applyLanguage, readLanguage, setLanguage, t} from './i18n';
afterEach(()=>vi.unstubAllGlobals());
describe('language preference',()=>{
  it('uses Arabic browser language, but an explicit English choice wins',()=>{
    vi.stubGlobal('window',{navigator:{language:'ar-AE'},localStorage:{getItem:()=>null}});
    expect(readLanguage()).toBe('ar');
    vi.stubGlobal('window',{navigator:{language:'ar'},localStorage:{getItem:()=> 'en'}});
    expect(readLanguage()).toBe('en');
  });
  it('works when storage is blocked and preserves unknown UI copy in English',()=>{
    const root={lang:'',dir:''};
    vi.stubGlobal('document',{documentElement:root});
    vi.stubGlobal('window',{navigator:{language:'en'},localStorage:{getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')}}});
    expect(readLanguage()).toBe('en');
    setLanguage('ar');expect(root).toEqual({lang:'ar',dir:'rtl'});
    expect(t('Settings')).toBe('الإعدادات');expect(t('New fallback text')).toBe('New fallback text');
    applyLanguage('en');expect(t('Settings')).toBe('Settings');expect(root.dir).toBe('ltr');
  });
});
