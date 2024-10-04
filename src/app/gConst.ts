import * as gIF from './gIF';

export const BE = false;
export const LE = true;
export const HEAD_LEN = 5;
export const LEN_IDX = 2;
export const CRC_IDX = 4;

export const SL_START_CHAR = 0x01;
export const SL_ESC_CHAR = 0x02;
export const SL_END_CHAR = 0x03;

export const SL_MSG_LOG = 0x8001;
export const SL_MSG_TESTPORT = 0x0a09;
export const SL_MSG_USB_CMD = 0x0a0d;

export const USB_CMD_WR_PAGE        = 0x01;
export const USB_CMD_SOFTWARE_RESET = 0x02;
export const USB_CMD_DONE           = 0x03;
export const USB_CMD_KEEP_AWAKE     = 0x04;
export const USB_CMD_RD_KEYS        = 0x05;
export const USB_CMD_RD_NODE_DATA_0 = 0x06;
export const USB_CMD_WR_KEYS        = 0x07;
export const USB_CMD_READ_PART_NUM  = 0x08;
export const USB_CMD_WR_NODE_DATA_0 = 0x09;

export const USB_CMD_STATUS_OK = 0x00;
export const USB_CMD_STATUS_FAIL = 0x01;

export const FLASH_STATUS_OK            = 0;
export const FLASH_STATUS_INIT_FAIL     = 1;
export const FLASH_STATUS_ERASE_FAIL    = 2;
export const FLASH_STATUS_PROG_FAIL     = 3;
export const FLASH_STATUS_VERIFY_FAIL   = 4;
export const FLASH_STATUS_READ_FAIL     = 5;

