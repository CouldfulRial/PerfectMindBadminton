chrome.action.onClicked.addListener(tab => {
  const options={url: chrome.runtime.getURL('index.html')};
  if(Number.isInteger(tab?.windowId)) options.windowId=tab.windowId;
  chrome.tabs.create(options);
});
