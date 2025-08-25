import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
// import { refreshApex } from '@salesforce/apex';
import getAirports from '@salesforce/apex/EnNsInventoryController.getAirports';
import getRoomInventoryForWalkIn from '@salesforce/apex/EnNsWalkInController.getRoomInventoryForWalkIn';
import createWalkInBooking from '@salesforce/apex/EnNsWalkInController.createWalkInBooking';
import searchCustomer from '@salesforce/apex/EnNsCustomerController.searchCustomerByPhone';
import getRoomBookingsForDate from '@salesforce/apex/EnNsWalkInController.getRoomBookingsForDate';
import updateBookingStatus from '@salesforce/apex/EnNsWalkInController.updateBookingStatus';
import extendRoomBooking from '@salesforce/apex/EnNsWalkInController.extendRoomBooking';
import updateRoomStatus from '@salesforce/apex/EnNsWalkInController.updateRoomStatus';

import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { getPicklistValuesByRecordType } from 'lightning/uiObjectInfoApi';
import ACCOUNT_OBJECT from '@salesforce/schema/Account';

export default class EnNsWalkInBooking extends LightningElement {
    @track selectedAirport = ''; // Will be set to Delhi airport DEL by default
    @track selectedDate = new Date().toISOString().split('T')[0];
    @track airports = [];
    @track roomInventory = [];
    @track loading = false;
    @track showBookingForm = false;
    @track selectedRoom = null;
    @track selectedDuration = '';
    @track selectedStartTime = null;
    @track selectedStartTimeString = '';
    @track showRoomBookingsModal = false;
    @track selectedRoomForBookings = null;
    @track roomBookings = [];
    @track loadingBookings = false;

    @track nationalityOptions = [];
    @track idTypeOptions = [];

    // Customer form data
    @track customerData = {
        // Basic Info
        title: '',
        firstName: '',
        lastName: '',
        email: '',
        phone: '',

        // Address
        businessAddress: false,
        privateAddress: true,
        street: '',
        city: '',
        statePostalCode: '',
        country: 'India',

        // Identity
        nationality: '',
        passportNumber: '',
        passportIssueDate: '',
        passportExpiryDate: '',
        passportIssuePlace: '',

        // Payment
        paymentMethod: '',

        // Additional
        specialRequests: '',
        emergencyContact: '',
        emergencyPhone: '',

        // System fields
        isExisting: false,
        customerId: null
    };

    // Duration options
    durationOptions = [
        { label: '3 Hours', value: '3' },
        { label: '6 Hours', value: '6' },
        { label: '6 + 6 Hours', value: '12' }
    ];

    showerDurationOptions = [
        { label: '30 Minutes', value: '0.5' }
    ];

    titleOptions = [
        { label: 'Mr.', value: 'Mr.' },
        { label: 'Mrs.', value: 'Mrs.' },
        { label: 'Ms.', value: 'Ms.' },
        { label: 'Dr.', value: 'Dr.' }
    ];

    paymentMethodOptions = [
        { label: 'Cash', value: 'Cash' },
        { label: 'Credit Card', value: 'Credit Card' },
        { label: 'Debit Card', value: 'Debit Card' },
        { label: 'UPI', value: 'UPI' },
        { label: 'Net Banking', value: 'Net Banking' }
    ];

    wiredAirportsResult;

    // Get Object Info
    @wire(getObjectInfo, { objectApiName: ACCOUNT_OBJECT })
    objectInfo;

    @wire(getPicklistValuesByRecordType, { 
        objectApiName: ACCOUNT_OBJECT, 
        recordTypeId: '$objectInfo.data.defaultRecordTypeId'
    })
    picklistValuesHandler({ data, error }) {
        if (data) {
            this.nationalityOptions = data.picklistFieldValues.Nationality__c.values; 
            this.idTypeOptions = data.picklistFieldValues.Id_Type__c.values; 
        } else if (error) {
            console.error(error);
        }
    }

    @wire(getAirports)
    wiredAirports(result) {
        this.wiredAirportsResult = result;
        if (result.data) {
            this.airports = result.data.map(airport => ({
                label: `${airport.Name} (${airport.Airport_Code__c})`,
                value: airport.Id,
                code: airport.Airport_Code__c
            }));

            // Set default to Delhi airport (DEL)
            const delhiAirport = this.airports.find(airport =>
                airport.code === 'DEL' || airport.label.includes('Delhi')
            );
            if (delhiAirport) {
                this.selectedAirport = delhiAirport.value;
                this.loadRoomInventory();
            } else if (this.airports.length > 0) {
                this.selectedAirport = this.airports[0].value;
                this.loadRoomInventory();
            }
        }
    }

    async loadRoomInventory() {
        if (!this.selectedAirport || !this.selectedDate) return;

        this.loading = true;
        try {
            // Force refresh by calling non-cacheable method
            this.roomInventory = await getRoomInventoryForWalkIn({
                airportId: this.selectedAirport,
                selectedDate: this.selectedDate
            });
        } catch (error) {
            this.showToast('Error', 'Failed to load room inventory', 'error');
            console.error('Error loading room inventory:', error);
        } finally {
            this.loading = false;
        }
    }

    handleAirportChange(event) {
        this.selectedAirport = event.detail.value;
        this.loadRoomInventory();
    }

    handleDateChange(event) {
        this.selectedDate = event.detail.value;
        this.loadRoomInventory();
    }

    handleRoomSelect(event) {
        const roomId = event.currentTarget.dataset.roomId;
        const room = this.roomInventory.find(r => r.roomId === roomId);

        if (!room) return;

        if (room.status === 'maintenance') {
            this.showToast('Unavailable', 'This room is under maintenance', 'warning');
            return;
        }

        this.selectedRoom = room;
        this.selectedDuration = '';
        this.setDefaultStartTime(room);
        this.resetCustomerData();
        this.showBookingForm = true;
    }

    handleDurationChange(event) {
        this.selectedDuration = event.detail.value;
    }

    handleStartTimeChange(event) {
        const startTimeString = event.detail.value;
        this.selectedStartTimeString = startTimeString;
        this.selectedStartTime = new Date(startTimeString);
    }

    setDefaultStartTime(room) {
        const now = new Date();
        let startTime;

        if (room.status === 'occupied') {
            // If room is occupied, start after current booking ends + 30 minutes
            startTime = new Date(room.nextAvailableTime);
        } else {
            // If room is available, start now (rounded to next 15 minutes)
            const minutes = now.getMinutes();
            const roundedMinutes = Math.ceil(minutes / 15) * 15;
            startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), roundedMinutes);
        }

        this.selectedStartTime = startTime;
        // Convert to datetime-local format (YYYY-MM-DDTHH:mm)
        this.selectedStartTimeString = startTime.getFullYear() + '-' +
            String(startTime.getMonth() + 1).padStart(2, '0') + '-' +
            String(startTime.getDate()).padStart(2, '0') + 'T' +
            String(startTime.getHours()).padStart(2, '0') + ':' +
            String(startTime.getMinutes()).padStart(2, '0');
    }

    async handlePhoneChange(event) {
        const phone = event.target.value;
        this.customerData.phone = phone;

        if (phone.length >= 10) {
            try {
                const existingCustomer = await searchCustomer({ phone: phone });
                if (existingCustomer) {
                    this.customerData = {
                        ...this.customerData,
                        title: existingCustomer.Salutation,
                        firstName: existingCustomer.FirstName,
                        lastName: existingCustomer.LastName,
                        name: existingCustomer.Name,
                        email: existingCustomer.PersonEmail,
                        nationality: existingCustomer.Nationality__c,
                        street: existingCustomer.BillingStreet,
                        city: existingCustomer.BillingCity,
                        statePostalCode: existingCustomer.BillingState,
                        country: existingCustomer.BillingCountry,
                        passportNumber: existingCustomer.Id_Passport_Number__c,
                        passportIssuePlace: existingCustomer.Id_Issue_Place__c,
                        passportIssueDate: existingCustomer.Id_Issue_Date__c,
                        passportExpiryDate: existingCustomer.Id_Expiry_Date__c,
                        idType: existingCustomer.Id_Type__c,
                        nationality: existingCustomer.Nationality__c,
                        isExisting: true,
                        customerId: existingCustomer.Id
                    };

                    console.log('customerData ->' + JSON.stringify(this.customerData));
                } else {
                    this.customerData.isExisting = false;
                    this.customerData.customerId = null;
                }
            } catch (error) {
                console.error('Error searching customer:', error);
            }
        }
    }

    handleCustomerFieldChange(event) {
        const field = event.target.dataset.field;
        this.customerData[field] = event.target.value;
    }

    async handleCreateBooking() {
        if (this.isFormInvalid) {
            this.showToast('Error', 'Please fill all required fields', 'error');
            return;
        }

        this.loading = true;
        try {
            const bookingData = {
                roomId: this.selectedRoom.roomId,
                airportId: this.selectedAirport,
                duration: this.selectedDuration,
                startDateTime: this.selectedStartTime.toISOString(),
                customerData: this.customerData
            };

            const result = await createWalkInBooking({ bookingRequest: JSON.stringify(bookingData) });

            this.showToast('Success', 'Walk-in booking created successfully!', 'success');
            this.closeBookingForm();
            this.loadRoomInventory(); // Refresh room data

            // Open registration print page
            // if (result && result.opportunityId) {
            //     const registrationUrl = `/c/EnNsRegistrationPrintApp.app?recordId=${result.opportunityId}`;
            //     window.open(registrationUrl, '_blank');
            // }
        } catch (error) {
            this.showToast('Error', error.body?.message || 'Failed to create booking', 'error');
        } finally {
            this.loading = false;
        }
    }

    async handleRoomToggle(event) {
        const roomId = event.currentTarget.dataset.roomId;
        const isActive = event.detail.checked;

        try {
            await updateRoomStatus({ roomId: roomId, isActive: isActive });
            this.showToast('Success', `Room ${isActive ? 'activated' : 'deactivated'} successfully`, 'success');
            this.loadRoomInventory(); // Refresh room data
        } catch (error) {
            this.showToast('Error', 'Failed to update room status', 'error');
            // Revert the toggle
            event.target.checked = !isActive;
        }
    }

    closeBookingForm() {
        this.showBookingForm = false;
        this.selectedRoom = null;
        this.selectedDuration = '';
        this.selectedStartTime = null;
        this.selectedStartTimeString = '';
        this.resetCustomerData();
    }

    resetCustomerData() {
        this.customerData = {
            // Basic Info
            title: '',
            firstName: '',
            lastName: '',
            email: '',
            phone: '',

            // Address
            businessAddress: false,
            privateAddress: true,
            street: '',
            city: '',
            statePostalCode: '',
            country: 'India',

            // Identity
            nationality: '',
            passportNumber: '',
            passportIssueDate: '',
            passportExpiryDate: '',
            passportIssuePlace: '',

            // Payment
            paymentMethod: '',

            // Additional
            specialRequests: '',
            emergencyContact: '',
            emergencyPhone: '',

            // System fields
            isExisting: false,
            customerId: null
        };
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({
            title,
            message,
            variant
        }));
    }

    get isFormValid() {
        return this.selectedRoom &&
            this.selectedDuration &&
            this.selectedStartTime &&
            this.customerData.firstName &&
            this.customerData.lastName &&
            this.customerData.phone &&
            this.customerData.email && this.isValidEmail(this.customerData.email) &&
            this.customerData.street &&
            this.customerData.city &&
            this.customerData.country &&
            this.customerData.nationality &&
            this.customerData.passportNumber &&
            this.customerData.paymentMethod;
    }

    isValidEmail(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    }

    get isFormInvalid() {
        return !this.isFormValid;
    }

    get formattedStartTime() {
        return this.selectedStartTime ?
            this.selectedStartTime.toLocaleString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                month: 'short',
                day: 'numeric'
            }) : '';
    }

    get formattedEndTime() {
        if (!this.selectedStartTime || !this.selectedDuration) return '';

        const endTime = new Date(this.selectedStartTime.getTime() + (this.selectedDuration * 60 * 60 * 1000));
        return endTime.toLocaleString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            month: 'short',
            day: 'numeric'
        });
    }

    get customerStatusMessage() {
        return this.customerData.isExisting ?
            'Existing customer found' :
            'New customer - please fill details';
    }

    get customerStatusClass() {
        return this.customerData.isExisting ?
            'slds-text-color_success' :
            'slds-text-color_default';
    }

    get availableDurationOptions() {
        if (this.selectedRoom && this.selectedRoom.roomType === 'Shower Only') {
            return this.showerDurationOptions;
        }
        return this.durationOptions;
    }

    async handleViewBookings(event) {
        const roomId = event.currentTarget.dataset.roomId;
        const room = this.roomInventory.find(r => r.roomId === roomId);

        if (!room) return;

        this.selectedRoomForBookings = room;
        this.loadingBookings = true;
        this.showRoomBookingsModal = true;

        try {
            const bookings = await getRoomBookingsForDate({
                roomId: roomId,
                selectedDate: this.selectedDate
            });

            this.roomBookings = bookings.map(booking => ({
                ...booking,
                maskedPhone: this.maskPhoneNumber(booking.customerPhone),
                bookingUrl: `/${booking.bookingId}`,
                canCheckIn: booking.status === 'Confirmed',
                canCheckOut: booking.status === 'In Progress',
                canExtend: booking.status === 'In Progress',
                canCancel: ['Draft', 'Confirmed'].includes(booking.status),
                canMarkNoShow: booking.status === 'Confirmed'
            }));
        } catch (error) {
            this.showToast('Error', 'Failed to load room bookings', 'error');
            console.error('Error loading room bookings:', error);
        } finally {
            this.loadingBookings = false;
        }
    }

    maskPhoneNumber(phone) {
        if (!phone || phone.length < 6) return phone;
        const firstTwo = phone.substring(0, 2);
        const lastFour = phone.substring(phone.length - 4);
        const masked = '*'.repeat(phone.length - 6);
        return firstTwo + masked + lastFour;
    }

    closeRoomBookingsModal() {
        this.showRoomBookingsModal = false;
        this.selectedRoomForBookings = null;
        this.roomBookings = [];
    }

    async handleBookingAction(event) {
        const action = event.currentTarget.dataset.action;
        const bookingId = event.currentTarget.dataset.bookingId;
        const hour = event.currentTarget.dataset.hour;

        try {
            this.loadingBookings = true;

            switch (action) {
                case 'checkin':
                    await updateBookingStatus({ opportunityId: bookingId, status: 'In Progress' });
                    this.showToast('Success', 'Customer checked in successfully', 'success');
                    const registrationUrl = `/c/EnNsRegistrationPrintApp.app?recordId=${bookingId}`;
                    window.open(registrationUrl, '_blank');
                    break;
                case 'checkout':
                    let attachmentId = await updateBookingStatus({ opportunityId: bookingId, status: 'Completed' });
                    const url = `/servlet/servlet.FileDownload?file=${attachmentId}`;                    
                    this.showToast('Success', 'Customer checked out successfully', 'success');
                    window.open(url, '_blank');
                    break;
                case 'cancel':
                    await updateBookingStatus({ opportunityId: bookingId, status: 'Cancelled' });
                    this.showToast('Success', 'Booking cancelled successfully', 'success');
                    break;
                case 'noshow':
                    await updateBookingStatus({ opportunityId: bookingId, status: 'No Show' });
                    this.showToast('Success', 'Booking marked as No Show', 'success');
                    break;
                case 'extend':
                    await extendRoomBooking({ opportunityId: bookingId, additionalHours: parseInt(hour) });
                    this.showToast('Success', 'Booking extended by ' + parseInt(hour) + ' hour', 'success');
                    break;
            }

            // Refresh bookings
            await this.handleViewBookings({ currentTarget: { dataset: { roomId: this.selectedRoomForBookings.roomId } } });
            await this.loadRoomInventory(); // Refresh room status

        } catch (error) {
            this.showToast('Error', error.body?.message || 'Action failed', 'error');
        } finally {
            this.loadingBookings = false;
        }
    }
}