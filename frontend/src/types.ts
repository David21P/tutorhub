export type Role = 'student' | 'tutor' | 'admin';
export type Modality = 'virtual' | 'tutor_home' | 'student_home';
export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed';

export interface TutorProfile {
  bio: string;
  hourly_rate: number;
  cv_file_id: string | null;
  portfolio_url: string | null;
  approval_status: 'pending' | 'approved' | 'rejected';
  approval_note: string | null;
  rating_avg: number;
  rating_count: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  photo_url: string | null;
  role: Role | null;
  onboarded: boolean;
  phone: string | null;
  gender: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  id_document_number: string | null;
  status: 'active' | 'suspended';
  category_ids: number[];
  tutor: TutorProfile | null;
}

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  active: boolean;
}

export interface OfferSummary {
  id: string;
  title: string;
  description?: string;
  category_id: number;
  category_name: string;
  modalities: Modality[];
  hourly_rate: number;
  km_rate: number;
  active?: boolean;
}

export interface TutorCard {
  tutor_id: string;
  tutor_name: string;
  photo_url: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  bio: string;
  rating_avg: number;
  rating_count: number;
  distance_km: number | null;
  min_rate: number;
  offers: OfferSummary[];
}

export interface Review {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
  student_name: string;
}

export interface AvailabilityBlock {
  weekday: number;
  start_min: number;
  end_min: number;
}

export interface TutorDetail {
  tutor: {
    id: string;
    name: string;
    photo_url: string | null;
    address: string | null;
    lat: number | null;
    lng: number | null;
    bio: string;
    portfolio_url: string | null;
    cv_file_id: string | null;
    rating_avg: number;
    rating_count: number;
    distance_km: number | null;
  };
  offers: OfferSummary[];
  availability: AvailabilityBlock[];
  reviews: Review[];
}

export interface PriceBreakdown {
  minutes: number;
  hours: number;
  hourly_rate: number;
  base_amount: number;
  distance_km: number;
  km_rate: number;
  round_trip: boolean;
  billable_km: number;
  travel_amount: number;
  total_amount: number;
}

export interface RouteInfo {
  distance_km: number;
  duration_min: number | null;
  geometry: [number, number][];
  source: 'osrm' | 'estimate';
}

export interface Quote {
  breakdown: PriceBreakdown;
  route: RouteInfo | null;
  tutor_location: { lat: number; lng: number } | null;
  student_location: { lat: number; lng: number } | null;
}

export interface Booking {
  id: string;
  subscription_id: string | null;
  offer_id: string;
  offer_title: string;
  category_name: string;
  tutor_id: string;
  tutor_name: string;
  student_id: string;
  student_name: string;
  starts_at: string;
  ends_at: string;
  modality: Modality;
  status: BookingStatus;
  hours: number;
  hourly_rate: number;
  base_amount: number;
  distance_km: number;
  km_rate: number;
  travel_amount: number;
  total_amount: number;
  student_address: string | null;
  student_lat: number | null;
  student_lng: number | null;
  tutor_address: string | null;
  tutor_lat: number | null;
  tutor_lng: number | null;
  notes: string | null;
  cancel_reason: string | null;
  reviewed: boolean;
  counterpart_phone: string | null;
}

export interface Subscription {
  id: string;
  student_id: string;
  student_name: string;
  tutor_id: string;
  tutor_name: string;
  offer_title: string;
  modality: Modality;
  plan: 'monthly' | 'block';
  weeks: number;
  auto_renew: boolean;
  weekdays: number[];
  start_min: number;
  duration_min: number;
  start_date: string;
  status: 'pending' | 'active' | 'rejected' | 'cancelled' | 'finished';
  sessions: number;
  upcoming: number;
  total_amount: number;
}

export interface Conversation {
  id: string;
  other_id: string;
  other_name: string;
  other_photo: string | null;
  last_body: string | null;
  last_message_at: string | null;
  unread: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  is_system?: boolean;
}

export interface Slot {
  starts_at: string;
  ends_at: string;
  label: string;
}
