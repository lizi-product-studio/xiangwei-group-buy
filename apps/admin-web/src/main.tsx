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
          colorPrimary: '#e94e30',
          colorLink: '#597a43',
          colorSuccess: '#597a43',
          colorWarning: '#ac772b',
          colorError: '#bd4535',
          colorText: '#23312d',
          colorTextSecondary: '#727b71',
          colorBgLayout: '#f7f7f2',
          colorBgContainer: '#fffefa',
          colorBorder: '#e2e3d9',
          colorBorderSecondary: '#e9e7df',
          borderRadius: 8,
          controlHeight: 38,
          fontFamily: '-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif',
        },
        components: {
          Card: { borderRadiusLG: 12, headerFontSize: 16, headerHeight: 58 },
          Table: { headerBg: '#fafaf5', headerColor: '#6e786b', rowHoverBg: '#f8f9f2', cellPaddingBlock: 17, cellPaddingInline: 18, borderColor: '#eeeee7' },
          Menu: { itemSelectedBg: '#fcede7', itemSelectedColor: '#d74429', itemHoverBg: '#f4f4ec', itemColor: '#697269' },
          Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500 },
          Form: { labelColor: '#354136', labelFontSize: 13, itemMarginBottom: 22 },
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

