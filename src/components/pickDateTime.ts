import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

/** Shows the native Android date picker followed by the time picker. Resolves null if dismissed. */
export function pickDateTime(initial: number): Promise<number | null> {
  return new Promise((resolve) => {
    DateTimePickerAndroid.open({
      value: new Date(initial),
      mode: 'date',
      minimumDate: new Date(),
      onChange: (event, date) => {
        if (event.type !== 'set' || !date) return resolve(null);
        DateTimePickerAndroid.open({
          value: date,
          mode: 'time',
          onChange: (timeEvent, time) => {
            if (timeEvent.type !== 'set' || !time) return resolve(null);
            const combined = new Date(date);
            combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
            resolve(combined.getTime());
          },
        });
      },
    });
  });
}
