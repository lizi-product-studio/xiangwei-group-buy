import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { App } from './App.tsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#c2412d',
          colorLink: '#3f6b35',
          colorSuccess: '#3f6b35',
          colorWarning: '#85510b',
          colorError: '#b42318',
          colorText: '#23312d',
          colorTextSecondary: '#626c60',
          colorBgLayout: '#faf8f2',
          colorBgContainer: '#fffefa',
          colorBorder: '#e2e3d9',
          colorBorderSecondary: '#e6e3d8',
          borderRadius: 8,
          controlHeight: 40,
          fontSize: 14,
          fontFamily: '-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif',
        },
        components: {
          Card: { borderRadiusLG: 12, headerFontSize: 16, headerHeight: 58 },
          Table: { headerBg: '#fafaf5', headerColor: '#6e786b', rowHoverBg: '#f8f9f2', cellPaddingBlock: 17, cellPaddingInline: 18, borderColor: '#eeeee7' },
          Menu: { itemSelectedBg: '#fff0eb', itemSelectedColor: '#c2412d', itemHoverBg: '#f4f4ec', itemColor: '#697269' },
          Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500 },
          Form: { labelColor: '#354136', labelFontSize: 14, itemMarginBottom: 22 },
          Drawer: { colorBgElevated: '#fffefa', paddingLG: 28 },
          Modal: { contentBg: '#fffefa', headerBg: '#fffefa', borderRadiusLG: 14 },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ConfigProvider>
  </React.StrictMode>,
);

