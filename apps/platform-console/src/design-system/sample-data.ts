export const SAMPLE_INSTALLS = [
  {
    id: 'HM-2041',
    gymEn: 'Nile Athletics',
    gymAr: 'نايل أثليتكس',
    license: 'Local Edition',
    status: 'active' as const,
    installEn: 'Front desk · Cairo',
    installAr: 'الاستقبال · القاهرة',
    updated: '16 Sep 2026',
  },
  {
    id: 'HM-2042',
    gymEn: 'Delta Fit',
    gymAr: 'دلتا فت',
    license: 'Local Edition',
    status: 'expiring' as const,
    installEn: 'Workstation 02',
    installAr: 'محطة 02',
    updated: '14 Sep 2026',
  },
  {
    id: 'HM-1988',
    gymEn: 'Red Sea Club',
    gymAr: 'نادي البحر الأحمر',
    license: 'Local Edition',
    status: 'suspended' as const,
    installEn: 'Offline 11 days',
    installAr: 'غير متصل 11 يوماً',
    updated: '05 Sep 2026',
  },
  {
    id: 'HM-2104',
    gymEn: 'October Strength',
    gymAr: 'أكتوبر سترينث',
    license: 'Cloud tenant',
    status: 'pending' as const,
    installEn: 'Activation queued',
    installAr: 'بانتظار التفعيل',
    updated: '16 Sep 2026',
  },
] as const

export const SAMPLE_TICKETS = [
  { id: 'SR-118', gymEn: 'Delta Fit', gymAr: 'دلتا فت', topicEn: 'Card reader timeout', topicAr: 'انتهاء مهلة قارئ البطاقات', tone: 'warning' as const },
  { id: 'SR-121', gymEn: 'Nile Athletics', gymAr: 'نايل أثليتكس', topicEn: 'Backup verification', topicAr: 'التحقق من النسخة', tone: 'info' as const },
]
