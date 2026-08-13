const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getBookings: () => ipcRenderer.invoke('bookings:getAll'),
  saveBooking: (booking) => ipcRenderer.invoke('bookings:save', booking),
  deleteBooking: (id) => ipcRenderer.invoke('bookings:delete', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  printContent: (options) => ipcRenderer.invoke('print:content', options),
  exportPDF: (options) => ipcRenderer.invoke('print:toPDF', options),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  replaceAllBookings: (bookings) => ipcRenderer.invoke('bookings:replaceAll', bookings),
  exportBackup: (jsonString) => ipcRenderer.invoke('backup:export', jsonString),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  getAutoBackupInfo: () => ipcRenderer.invoke('backup:autoInfo'),
  openAutoBackupFolder: () => ipcRenderer.invoke('backup:openAutoFolder'),
  getRemoteInfo: () => ipcRenderer.invoke('remote:getInfo'),
  setRemoteEnabled: (enabled) => ipcRenderer.invoke('remote:setEnabled', enabled),
  regenerateRemoteToken: () => ipcRenderer.invoke('remote:regenerateToken')
});
